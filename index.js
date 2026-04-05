import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { Telegraf } from 'telegraf';
import { fileURLToPath } from 'url';

// Resolve directory in ES module mode
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Environment configuration
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const AI_ENDPOINT = process.env.AI_ENDPOINT;
const ADMIN_IDS = (process.env.ADMIN_IDS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

if (!TELEGRAM_TOKEN) throw new Error('Missing TELEGRAM_TOKEN in .env');
if (!AI_ENDPOINT) throw new Error('Missing AI_ENDPOINT in .env');

// Project folders/files
const logsDir = path.join(__dirname, 'logs');
const dataDir = path.join(__dirname, 'data');
const usersJsonPath = path.join(dataDir, 'users.json');

// Ensure required directories and profile file exist
function ensureStorage() {
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(usersJsonPath)) fs.writeFileSync(usersJsonPath, '{}\n', 'utf8');
}

// Read user profile JSON safely
function readUsersData() {
  try {
    const raw = fs.readFileSync(usersJsonPath, 'utf8');
    return JSON.parse(raw || '{}');
  } catch (error) {
    console.error('Error reading users.json:', error.message);
    return {};
  }
}

// Persist user profile JSON safely
function writeUsersData(data) {
  fs.writeFileSync(usersJsonPath, JSON.stringify(data, null, 2), 'utf8');
}

// Return YYYY-MM-DD
function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

// Return YYYY-MM-DD HH:MM
function nowLogTimestamp() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

function isAdmin(userId) {
  return ADMIN_IDS.includes(String(userId));
}

// Keep runtime stats in memory
const userIds = new Set();
let totalMessages = 0;

function registerUser(ctx) {
  const userId = ctx.from?.id;
  if (!userId) return null;

  userIds.add(userId);

  const users = readUsersData();
  const key = String(userId);

  if (!users[key]) {
    users[key] = {
      name: ctx.from?.first_name || 'Unknown',
      messages: 0,
      joined: todayDate()
    };
    writeUsersData(users);
  }

  return userId;
}

function incrementUserMessageCount(userId) {
  if (!userId) return;

  const users = readUsersData();
  const key = String(userId);

  if (!users[key]) {
    users[key] = {
      name: 'Unknown',
      messages: 0,
      joined: todayDate()
    };
  }

  users[key].messages += 1;
  writeUsersData(users);
}

// Save user/AI chat history without database
function saveChatLog(userId, userText, aiText) {
  if (!userId) return;

  const logPath = path.join(logsDir, `chat_${userId}.log`);
  const entry = `[${nowLogTimestamp()}]\nUser: ${userText}\nAI: ${aiText}\n\n`;

  fs.appendFile(logPath, entry, 'utf8', (error) => {
    if (error) {
      console.error('Error saving chat log:', error.message);
      return;
    }
    console.log(`Saved chat log for user ${userId}`);
  });
}

ensureStorage();

const bot = new Telegraf(TELEGRAM_TOKEN);

bot.start((ctx) => {
  const userId = registerUser(ctx);
  console.log(`New user: ${userId}`);
  return ctx.reply('👋 Welcome! Send me any message to chat with AI. Use /help for commands.');
});

bot.help((ctx) => {
  registerUser(ctx);
  return ctx.reply([
    'Available commands:',
    '/start - Start bot',
    '/help - Show help',
    '/profile - Show your profile',
    '/setname <name> - Set your display name'
  ].join('\n'));
});

bot.command('profile', (ctx) => {
  const userId = registerUser(ctx);
  const users = readUsersData();
  const profile = users[String(userId)];

  if (!profile) return ctx.reply('Profile not found. Send a message first.');

  return ctx.reply([
    '👤 Your profile',
    `ID: ${userId}`,
    `Name: ${profile.name}`,
    `Messages: ${profile.messages}`,
    `Joined: ${profile.joined}`
  ].join('\n'));
});

bot.command('setname', (ctx) => {
  const userId = registerUser(ctx);
  const text = ctx.message?.text || '';
  const newName = text.replace(/^\/setname\s*/i, '').trim();

  if (!newName) return ctx.reply('Usage: /setname <name>');

  const users = readUsersData();
  const key = String(userId);

  if (!users[key]) {
    users[key] = { name: newName, messages: 0, joined: todayDate() };
  } else {
    users[key].name = newName;
  }

  writeUsersData(users);
  return ctx.reply(`✅ Name updated to: ${newName}`);
});

// Admin commands
bot.command('adminhelp', (ctx) => {
  registerUser(ctx);
  if (!ctx.from?.id || !isAdmin(ctx.from.id)) return ctx.reply('⛔ Admin only.');

  return ctx.reply([
    '🛠 Admin commands:',
    '/stats - Show users/messages stats',
    '/users - Show total users',
    '/broadcast <message> - Send message to all users',
    '/log <userid> - Send chat log file',
    '/restart - Restart bot'
  ].join('\n'));
});

bot.command('stats', (ctx) => {
  registerUser(ctx);
  if (!ctx.from?.id || !isAdmin(ctx.from.id)) return ctx.reply('⛔ Admin only.');

  return ctx.reply(`📊 Stats\nTotal users: ${userIds.size}\nTotal messages: ${totalMessages}`);
});

bot.command('users', (ctx) => {
  registerUser(ctx);
  if (!ctx.from?.id || !isAdmin(ctx.from.id)) return ctx.reply('⛔ Admin only.');

  return ctx.reply(`👥 Total users: ${userIds.size}`);
});

bot.command('broadcast', async (ctx) => {
  registerUser(ctx);
  if (!ctx.from?.id || !isAdmin(ctx.from.id)) return ctx.reply('⛔ Admin only.');

  const text = ctx.message?.text || '';
  const messageToSend = text.replace(/^\/broadcast\s*/i, '').trim();
  if (!messageToSend) return ctx.reply('Usage: /broadcast <message>');

  let sent = 0;
  let failed = 0;

  for (const uid of userIds) {
    try {
      await ctx.telegram.sendMessage(uid, `📢 Broadcast:\n${messageToSend}`);
      sent += 1;
    } catch (error) {
      failed += 1;
      console.error(`Broadcast failed for ${uid}:`, error.message);
    }
  }

  return ctx.reply(`Broadcast complete. Sent: ${sent}, Failed: ${failed}`);
});

bot.command('log', async (ctx) => {
  registerUser(ctx);
  if (!ctx.from?.id || !isAdmin(ctx.from.id)) return ctx.reply('⛔ Admin only.');

  const text = ctx.message?.text || '';
  const targetId = text.replace(/^\/log\s*/i, '').trim();

  if (!targetId) return ctx.reply('Usage: /log <userid>');

  const logPath = path.join(logsDir, `chat_${targetId}.log`);
  if (!fs.existsSync(logPath)) return ctx.reply(`No log file found for user ${targetId}.`);

  return ctx.replyWithDocument({ source: logPath, filename: `chat_${targetId}.log` });
});

bot.command('restart', async (ctx) => {
  registerUser(ctx);
  if (!ctx.from?.id || !isAdmin(ctx.from.id)) return ctx.reply('⛔ Admin only.');

  await ctx.reply('♻️ Restarting bot...');
  console.log('Bot restart requested by admin.');
  setTimeout(() => process.exit(0), 300);
});

// Main text handler for AI chat
bot.on('text', async (ctx) => {
  const userId = registerUser(ctx);

  // Skip command messages in text handler
  const incomingText = (ctx.message?.text || '').trim();
  if (incomingText.startsWith('/')) return;

  totalMessages += 1;
  incrementUserMessageCount(userId);

  try {
    // Typing animation before request
    await ctx.sendChatAction('typing');

    console.log('Sending request to AI API...');
    const response = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: incomingText, userId: String(userId) })
    });

    if (!response.ok) {
      throw new Error(`AI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log('Received response from AI API');

    const aiText = String(
      data?.response || data?.text || data?.result || data?.message || 'AI returned an empty response.'
    );

    await ctx.reply(aiText);
    saveChatLog(userId, incomingText, aiText);
  } catch (error) {
    console.error('Error happened:', error.message);
    await ctx.reply('⚠️ Sorry, I could not process your request right now.');
  }
});

bot
  .launch()
  .then(() => {
    console.log('Bot started');
  })
  .catch((error) => {
    console.error('Error happened:', error.message);
  });

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
