import 'dotenv/config';
import fetch from 'node-fetch';
import { Telegraf } from 'telegraf';

// Read environment variables from .env
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const AI_ENDPOINT = process.env.AI_ENDPOINT;
const ADMIN_IDS = (process.env.ADMIN_IDS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

if (!TELEGRAM_TOKEN) {
  throw new Error('Missing TELEGRAM_TOKEN in .env');
}

if (!AI_ENDPOINT) {
  throw new Error('Missing AI_ENDPOINT in .env');
}

const bot = new Telegraf(TELEGRAM_TOKEN);

// In-memory stats storage
const userIds = new Set();
let totalMessages = 0;

// Helper to check whether a Telegram user is an admin
function isAdmin(userId) {
  return ADMIN_IDS.includes(String(userId));
}

// /start command
bot.start((ctx) => {
  if (ctx.from?.id) userIds.add(ctx.from.id);

  return ctx.reply(
    '👋 Welcome! Send me any text and I will ask the AI for a response.\nUse /help to see commands.'
  );
});

// /help command
bot.help((ctx) => {
  if (ctx.from?.id) userIds.add(ctx.from.id);

  return ctx.reply(
    [
      'Available commands:',
      '/start - Start the bot',
      '/help - Show this help message',
      '/stats - Show bot stats (admin only)',
      '/broadcast <message> - Send a message to all users (admin only)',
      '',
      'You can also just send any text message to chat with the AI.'
    ].join('\n')
  );
});

// /stats command (admin only)
bot.command('stats', (ctx) => {
  if (ctx.from?.id) userIds.add(ctx.from.id);

  if (!ctx.from?.id || !isAdmin(ctx.from.id)) {
    return ctx.reply('⛔ You are not authorized to use this command.');
  }

  return ctx.reply(
    `📊 Bot stats\nTotal users: ${userIds.size}\nTotal messages: ${totalMessages}`
  );
});

// /broadcast command (admin only)
bot.command('broadcast', async (ctx) => {
  if (ctx.from?.id) userIds.add(ctx.from.id);

  if (!ctx.from?.id || !isAdmin(ctx.from.id)) {
    return ctx.reply('⛔ You are not authorized to use this command.');
  }

  // Extract message after command: /broadcast your message here
  const text = ctx.message?.text || '';
  const messageToSend = text.replace(/^\/broadcast\s*/i, '').trim();

  if (!messageToSend) {
    return ctx.reply('Usage: /broadcast <message>');
  }

  let sentCount = 0;
  let failCount = 0;

  for (const userId of userIds) {
    try {
      await ctx.telegram.sendMessage(userId, `📢 Broadcast:\n${messageToSend}`);
      sentCount += 1;
    } catch (error) {
      failCount += 1;
      console.error(`Failed to send broadcast to ${userId}:`, error.message);
    }
  }

  return ctx.reply(`Broadcast finished. Sent: ${sentCount}, Failed: ${failCount}`);
});

// Handle all text messages and forward them to the AI endpoint
bot.on('text', async (ctx) => {
  if (ctx.from?.id) userIds.add(ctx.from.id);
  totalMessages += 1;

  // Skip processing for known commands so they are not sent to AI
  const incomingText = ctx.message.text.trim();
  if (incomingText.startsWith('/start') || incomingText.startsWith('/help')) return;
  if (incomingText.startsWith('/stats') || incomingText.startsWith('/broadcast')) return;

  try {
    const response = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: incomingText })
    });

    if (!response.ok) {
      throw new Error(`AI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Flexible parsing to support common response field names
    const aiText =
      data?.response ||
      data?.text ||
      data?.result ||
      data?.message ||
      '⚠️ AI returned an empty response.';

    // Optional debug logging
    console.log('[AI RESPONSE]', aiText);

    await ctx.reply(String(aiText));
  } catch (error) {
    console.error('Error while getting AI response:', error.message);
    await ctx.reply('⚠️ Sorry, I could not get a response from the AI service right now.');
  }
});

// Start polling
bot
  .launch()
  .then(() => {
    console.log('✅ Telegram AI bot is running...');
  })
  .catch((error) => {
    console.error('Failed to launch bot:', error.message);
  });

// Graceful shutdown handlers
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
