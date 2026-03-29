const TelegramBot = require('node-telegram-bot-api');
const Groq = require('groq-sdk');
const ALFALF_SYSTEM_PROMPT = require('./prompt');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const WELCOME_MESSAGE = `
🌱 Welcome to Alfalf AI

I'm a Campaign Intelligence System for Web3 projects.
Not generic tasks — real participation systems.

Send your project details in this format:

Project: (your project name)
Goal: (what you want to achieve)
Duration: (how long the campaign runs)

Example:
Project: DeFi lending protocol
Goal: Increase TVL and retain users
Duration: 3 weeks
`;

const REWARD_QUESTION = `
Would you like me to design a fair reward structure for this campaign? 🎯

Reply with Yes or No.
`;

const REFINE_MESSAGE = `
Want to go deeper? Here's what I can help you refine:

- Improve retention design
- Reduce farming risk
- Adjust reward structure
- Rethink a weak phase

Just tell me what you'd like to optimize — or send a new project brief to start fresh.
`;

const REWARD_PROMPT = `
You are Alfalf AI — a Reward Structure Architect for Web3 campaigns.
Your job is to design fair, strategic reward systems that encourage real participation and discourage farming and favoritism.

You will receive:
- The campaign structure that was already generated
- The user's reward pool and number of winners

Use the campaign context to make your reward recommendation relevant and specific.
Always base your calculations on the exact reward pool and number of winners the user provides.
Never use placeholder or example numbers — always calculate from the actual user input.

1. 🏆 Recommend a Reward Model
Evaluate the campaign context and recommend the most appropriate model:
- Tiered distribution — top performers earn more, fairly spread across tiers
- Hybrid leaderboard + raffle — top tier earns fixed rewards, remaining enter raffle
- Broad participation model — many small equal rewards, encourages volume
- Contribution-based — rewards tied to quality of contribution, not just quantity

Explain specifically why this model fits this campaign and this reward pool size.
If the pool is small, say so and adjust recommendations accordingly.
If the pool is large, explain how to spread it effectively.

2. 💰 Example Distribution
Provide a percentage-based breakdown across winner tiers.
Label it clearly as: "Example distribution based on your inputs"

Then immediately after, provide the Practical Breakdown:

📊 Practical Breakdown:
Convert every percentage into exact dollar amounts using the user's actual reward pool.
Calculate precisely:
- Take each tier's percentage of the total reward pool
- Divide by the number of winners in that tier
- Show exact dollar amount per user per tier
- Round to maximum 2 decimal places

Format it exactly like this:
Winners 1–[X] → $[amount] each
Winners [X+1]–[Y] → $[amount] each
Winners [Y+1]–[Z] → $[amount] each (if raffle, state how many selected)
Total Winners → [number]
Total Payout → $[reward pool]

Always verify: all tier payouts must add up exactly to the total reward pool.
This section is mandatory — never skip it.

⚠️ Insight:
After the breakdown, add one short insight (2–3 sentences maximum).
Highlight if lower tiers are under-rewarded relative to effort.
Suggest one specific improvement to increase fairness or retention value.

3. ⚠️ Favoritism Risk Flags
Identify if the structure could be exploited by internal teams or moderators.
Flag top-heavy distributions that discourage broader participation.
Suggest transparency measures such as public leaderboard or on-chain verification.

4. 🤖 Farming Risk Flags
Identify if the reward structure encourages multi-accounting or bot farming.
Flag raffle systems combined with low-effort tasks.
Suggest effort-based qualifications before reward eligibility.

5. 🎲 Raffle Evaluation
NOT every campaign deserves a raffle. Evaluate carefully based on the campaign context.

Raffle WORKS when:
- The campaign has high volume of participants
- Tasks are contribution-based and effort is verifiable
- The goal is broad community participation
- The reward pool is large enough to make individual payouts meaningful

Raffle does NOT work when:
- Tasks are low-effort (like, retweet, simple join)
- The participant pool is small
- The reward pool is too small to split meaningfully across many winners
- The campaign goal is quality over quantity

If raffle fits — explain why and how to structure it fairly.
If raffle does not fit — say so directly and recommend a better model.
Do not suggest raffle by default just because there are many winners.

OUTPUT RULES:
- Clear and readable on Telegram mobile
- Use bullet points, keep it practical
- Always complete the Practical Breakdown with exact dollar calculations from user input
- Frame distribution as suggestion, not instruction
- Be direct about risks — do not soften feedback
- Keep the tone strategic and confident

TONE: Confident. Strategic. Practical. Not robotic.
`;

const userStates = {};

function sendLongMessage(chatId, text) {
  const maxLength = 4000;
  for (let i = 0; i < text.length; i += maxLength) {
    setTimeout(() => {
      bot.sendMessage(chatId, text.substring(i, i + maxLength));
    }, i / 2);
  }
}

function parseRewardInput(text) {
  const poolMatch = text.match(/reward\s*pool[:\s]*\$?([\d,]+)/i);
  const winnersMatch = text.match(/winners?[:\s]*([\d,]+)/i);

  if (!poolMatch || !winnersMatch) return null;

  const pool = parseFloat(poolMatch[1].replace(/,/g, ''));
  const winners = parseInt(winnersMatch[1].replace(/,/g, ''));

  if (isNaN(pool) || isNaN(winners) || pool <= 0 || winners <= 0) return null;

  return { pool, winners };
}

bot.onText(/\/start/, (msg) => {
  delete userStates[msg.chat.id];
  bot.sendMessage(msg.chat.id, WELCOME_MESSAGE);
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith('/')) return;

  // Check if user is sending a new campaign mid-flow — override state
  const hasProject = text.toLowerCase().includes('project:');
  const hasGoal = text.toLowerCase().includes('goal:');
  const hasDuration = text.toLowerCase().includes('duration:');
  const isNewCampaign = hasProject && hasGoal && hasDuration;

  if (isNewCampaign && userStates[chatId]?.step) {
    delete userStates[chatId];
  }

  const state = userStates[chatId]?.step;

  // State: waiting for reward pool input
  if (state === 'awaiting_reward') {

    const parsed = parseRewardInput(text);

    if (!parsed) {
      bot.sendMessage(chatId, `⚠️ I couldn't read your reward details. Please use this exact format:

💰 Reward pool: $500
🏆 Number of winners: 20

Make sure both are valid numbers.`);
      return;
    }

    userStates[chatId].step = null;

    bot.sendChatAction(chatId, 'typing');
    bot.sendMessage(chatId, '⚙️ Alfalf AI is designing your reward structure...');

    try {
      const lastCampaign = userStates[chatId]?.lastCampaign || '';

      const response = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: REWARD_PROMPT },
          {
            role: 'user',
            content: `Campaign context:\n${lastCampaign}\n\nReward pool: $${parsed.pool}\nNumber of winners: ${parsed.winners}`
          }
        ],
        temperature: 0.7,
        max_tokens: 1500,
      });

      const result = response.choices[0]?.message?.content;

      if (result) {
        sendLongMessage(chatId, result);
        setTimeout(() => {
          bot.sendMessage(chatId, REFINE_MESSAGE);
        }, 2000);
      } else {
        bot.sendMessage(chatId, '⚠️ Something went wrong while generating your reward structure.\n\nPlease try again.');
      }

    } catch (error) {
      console.error('Groq API error (reward):', error);
      bot.sendMessage(chatId, '⚠️ Something went wrong while generating your reward structure.\n\nPlease try again.');
    }

    return;
  }

  // State: waiting for yes/no on reward structure
  if (state === 'awaiting_reward_confirmation') {
    const cleaned = text.toLowerCase().trim();
    const isYes = ['yes', 'y', 'yeah', 'yep', 'sure', 'ok', 'okay'].includes(cleaned);
    const isNo = ['no', 'n', 'nah', 'nope'].includes(cleaned);

    if (isYes) {
      userStates[chatId].step = 'awaiting_reward';
      bot.sendMessage(chatId, `💰 Please provide your reward details in this format:

💰 Reward pool: $0000
🏆 Number of winners: 000

Example:
💰 Reward pool: $500
🏆 Number of winners: 20`);
      return;
    }

    if (isNo) {
      delete userStates[chatId];
      bot.sendMessage(chatId, `Got it 👍

If you want to refine the campaign later or test another idea, just send a new brief.`);
      return;
    }

    bot.sendMessage(chatId, `Please reply with Yes or No.

Would you like me to design a fair reward structure for this campaign? 🎯`);
    return;
  }

  // Default: expecting campaign input
  if (!isNewCampaign) {
    bot.sendMessage(chatId, `⚠️ Please use the correct format:

Project: (your project name)
Goal: (what you want to achieve)
Duration: (how long the campaign runs)

Example:
Project: DeFi lending protocol
Goal: Increase TVL and retain users
Duration: 3 weeks`);
    return;
  }

  bot.sendChatAction(chatId, 'typing');
  bot.sendMessage(chatId, '⚙️ Alfalf AI is designing your campaign system...');

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
      sendLongMessage(chatId, result);

      userStates[chatId] = {
        step: 'awaiting_reward_confirmation',
        lastCampaign: result,
        lastInput: text
      };

      setTimeout(() => {
        bot.sendMessage(chatId, REWARD_QUESTION);
      }, 1000);

    } else {
      bot.sendMessage(chatId, '⚠️ Something went wrong while generating your campaign.\n\nPlease try again — or simplify your input if it was very long.');
    }

  } catch (error) {
    console.error('Groq API error (campaign):', error);
    bot.sendMessage(chatId, '⚠️ Something went wrong while generating your campaign.\n\nPlease try again — or simplify your input if it was very long.');
  }
});

console.log('Alfalf AI bot is running...');
