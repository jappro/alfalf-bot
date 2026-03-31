const express = require('express');
const cors = require('cors');
const Groq = require('groq-sdk');
const db = require('./database');
const ALFALF_SYSTEM_PROMPT = require('./prompt');

const app = express();
app.use(cors());
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const REWARD_PROMPT = `
You are Alfalf AI — a Reward Structure Architect for Web3 campaigns.
Return ONLY a valid JSON array of tier objects. No explanation. No text. No markdown. Only raw JSON.

Format exactly like this:
[
  { "range": "1-5", "percentage": 40, "winners": 5 },
  { "range": "6-20", "percentage": 35, "winners": 15 },
  { "range": "21-50", "percentage": 25, "winners": 30 }
]

Rules:
- Percentages must add up to exactly 100
- Winners in each range must add up to total winners provided
- Choose tiers that make sense for the campaign context
- Never return anything except the JSON array
`;

const REFINEMENT_PROMPT = `
You are Alfalf AI — a Campaign Intelligence System for Web3 projects.
You are NOT generating a new campaign. You are refining an existing one.

You will receive the original campaign structure and a specific refinement goal.
Provide targeted improvements only. Focus exclusively on the refinement goal.
Do not regenerate the full campaign. Do not repeat sections that don't need changing.

Output: 5 to 10 bullet points maximum. Each point must be specific and actionable.
Tone: Direct. Strategic. Specific. No fluff.
`;

function calculateRewards(pool, tiers) {
  let totalPct = 0;
  let totalWinners = 0;

  for (const tier of tiers) {
    totalPct += tier.percentage;
    totalWinners += tier.winners;
  }

  if (Math.abs(totalPct - 100) > 0.1) return null;

  return tiers.map(tier => {
    const tierTotal = (tier.percentage / 100) * pool;
    const perUser = parseFloat((tierTotal / tier.winners).toFixed(2));
    return { ...tier, tierTotal: parseFloat(tierTotal.toFixed(2)), perUser };
  });
}

function extractScore(campaignOutput) {
  const match = campaignOutput.match(/overall\s*score[:\s]*([0-9.]+)\s*\/\s*10/i);
  return match ? parseFloat(match[1]) : null;
}

// ── ROUTES ──

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: 'V0.1' });
});

// Create campaign
app.post('/api/campaign', async (req, res) => {
  const { userId, projectName, goal, duration, projectType, platform } = req.body;

  if (!userId || !projectName || !goal || !duration || !projectType || !platform) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const userInput = `Project: ${projectName}\nGoal: ${goal}\nDuration: ${duration}\nProject Type: ${projectType}\nPlatform: ${platform}`;

  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: ALFALF_SYSTEM_PROMPT },
        { role: 'user', content: userInput }
      ],
      temperature: 0.7,
      max_tokens: 1800,
    });

    const campaignOutput = response.choices[0]?.message?.content;
    if (!campaignOutput) return res.status(500).json({ error: 'AI generation failed' });

    const score = extractScore(campaignOutput);

    const campaignId = db.createCampaign({
      userId, projectName, goal, duration,
      projectType, platform, campaignOutput,
      campaignScore: score
    });

    res.json({ campaignId, campaignOutput, score });

  } catch (err) {
    console.error('Campaign error:', err);
    res.status(500).json({ error: 'Campaign generation failed' });
  }
});

// Get campaign
app.get('/api/campaign/:id', (req, res) => {
  const data = db.getCampaign(req.params.id);
  if (!data || !data.campaign) return res.status(404).json({ error: 'Campaign not found' });
  res.json(data);
});

// Get all campaigns for a user
app.get('/api/campaigns/user/:userId', (req, res) => {
  const campaigns = db.getCampaignsByUser(req.params.userId);
  res.json({ campaigns });
});

// Generate reward
app.post('/api/campaign/:id/reward', async (req, res) => {
  const { rewardPool, winners } = req.body;
  const campaignId = req.params.id;

  if (!rewardPool || !winners) return res.status(400).json({ error: 'Missing rewardPool or winners' });

  const data = db.getCampaign(campaignId);
  if (!data || !data.campaign) return res.status(404).json({ error: 'Campaign not found' });

  try {
    let tiers = null;
    let attempts = 0;

    while (!tiers && attempts < 3) {
      attempts++;
      const response = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: REWARD_PROMPT },
          {
            role: 'user',
            content: `Campaign context:\n${data.campaign.campaign_output}\n\nReward pool: $${rewardPool}\nNumber of winners: ${winners}`
          }
        ],
        temperature: 0.5,
        max_tokens: 500,
      });

      const raw = response.choices[0]?.message?.content?.trim();
      try {
        const cleaned = raw.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(cleaned);
        const calculated = calculateRewards(rewardPool, parsed);
        if (calculated) tiers = { raw: parsed, calculated };
      } catch (e) {
        console.error('Tier parse error attempt', attempts, e);
      }
    }

    if (!tiers) return res.status(500).json({ error: 'Could not generate valid reward structure after 3 attempts' });

    db.saveReward(campaignId, {
      rewardPool,
      totalWinners: winners,
      distributionJson: tiers.raw,
      calculatedBreakdown: tiers.calculated
    });

    res.json({
      rewardPool,
      totalWinners: winners,
      tiers: tiers.calculated
    });

  } catch (err) {
    console.error('Reward error:', err);
    res.status(500).json({ error: 'Reward generation failed' });
  }
});

// Refine campaign
app.post('/api/campaign/:id/refine', async (req, res) => {
  const { type } = req.body;
  const campaignId = req.params.id;

  if (!type) return res.status(400).json({ error: 'Missing refinement type' });

  const data = db.getCampaign(campaignId);
  if (!data || !data.campaign) return res.status(404).json({ error: 'Campaign not found' });

  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: REFINEMENT_PROMPT },
        {
          role: 'user',
          content: `Original campaign:\n${data.campaign.campaign_output}\n\nRefinement goal: ${type}`
        }
      ],
      temperature: 0.7,
      max_tokens: 1000,
    });

    const output = response.choices[0]?.message?.content;
    if (!output) return res.status(500).json({ error: 'Refinement failed' });

    db.saveRefinement(campaignId, {
      type,
      inputContext: data.campaign.campaign_output,
      output
    });

    res.json({ type, output });

  } catch (err) {
    console.error('Refinement error:', err);
    res.status(500).json({ error: 'Refinement failed' });
  }
});

// Share campaign (public)
app.get('/api/share/:id', (req, res) => {
  const data = db.getCampaign(req.params.id);
  if (!data || !data.campaign) return res.status(404).json({ error: 'Campaign not found' });

  const { campaign, reward, refinements } = data;

  res.json({
    id: campaign.id,
    projectName: campaign.project_name,
    goal: campaign.goal,
    duration: campaign.duration,
    projectType: campaign.project_type,
    platform: campaign.platform,
    campaignOutput: campaign.campaign_output,
    campaignScore: campaign.campaign_score,
    createdAt: campaign.created_at,
    reward: reward ? {
      rewardPool: reward.reward_pool,
      totalWinners: reward.total_winners,
      breakdown: JSON.parse(reward.calculated_breakdown || '[]')
    } : null,
    refinements: refinements.map(r => ({
      type: r.type,
      output: r.output,
      createdAt: r.created_at
    }))
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Alfalf AI server running on port ${PORT}`));

module.exports = app;
