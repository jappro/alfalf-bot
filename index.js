const TelegramBot = require('node-telegram-bot-api');
const Groq = require('groq-sdk');
const http = require('http');
const https = require('https');
const ALFALF_SYSTEM_PROMPT = require('./prompt');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

bot.on('polling_error', (error) => {
  console.error('Polling error:', error.message);
});

const PORT = process.env.KEEP_ALIVE_PORT || 3000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'alive', bot: 'Alfalf AI', uptime: process.uptime() }));
});
server.listen(PORT, () => {
  console.log(`Keep-alive server listening on port ${PORT}`);
});

const REPL_DOMAIN = process.env.REPLIT_DOMAINS
  ? process.env.REPLIT_DOMAINS.split(',')[0].trim()
  : null;

function selfPing() {
  if (!REPL_DOMAIN) return;
  const url = `https://${REPL_DOMAIN}/api/healthz`;
  https.get(url, (res) => {
    console.log(`Self-ping: ${res.statusCode}`);
  }).on('error', (err) => {
    console.error('Self-ping error:', err.message);
  });
}

setInterval(selfPing, 4 * 60 * 1000);

const WELCOME_MESSAGE = `
🌱 Welcome to Alfalf AI

I design campaign systems for Web3 projects.
Not generic tasks — real participation loops.

Send your project details in this format:

Project: (your project name)
Goal: (what you want to achieve)
Duration: (how long the campaign runs)

Example:
Project: DeFi lending protocol
Goal: Increase TVL and retain users
Duration: 3 weeks
`;

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, WELCOME_MESSAGE, { parse_mode: 'Markdown' });
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith('/')) return;

  const hasProject = text.toLowerCase().includes('project:');
  const hasGoal = text.toLowerCase().includes('goal:');
  const hasDuration = text.toLowerCase().includes('duration:');

  if (!hasProject || !hasGoal || !hasDuration) {
    bot.sendMessage(chatId, `⚠️ Please use the correct format:

Project: (your project name)
Goal: (what you want to achieve)
Duration: (how long the campaign runs)`, { parse_mode: 'Markdown' });
    return;
  }

  bot.sendMessage(chatId, '⚙️ Alfalf AI is designing your campaign system...', { parse_mode: 'Markdown' });

  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: ALFALF_SYSTEM_PROMPT },
        { role: 'user', content: text }
      ],
      temperature: 0.7,
      max_tokens: 1800,
    });

    const result = response.choices[0]?.message?.content;

    if (result) {
      bot.sendMessage(chatId, result, { parse_mode: 'Markdown' });
    } else {
      bot.sendMessage(chatId, '❌ Something went wrong. Please try again.', { parse_mode: 'Markdown' });
    }

  } catch (error) {
    console.error('=== GROQ API ERROR ===');
    console.error('Status:', error.status);
    console.error('Message:', error.message);
    console.error('Error body:', JSON.stringify(error.error, null, 2));
    console.error('=====================');
    bot.sendMessage(chatId, '❌ Error generating campaign. Please try again.', { parse_mode: 'Markdown' });
  }
});

console.log('Alfalf AI bot is running...');
