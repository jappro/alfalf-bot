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
You are Alfalf AI — a Reward Distribution Engine for Web3 campaigns.

You do NOT explain anything.
You do NOT justify decisions.
You ONLY return a valid JSON array of reward tiers.

━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT (STRICT)
━━━━━━━━━━━━━━━━━━━

Return ONLY a JSON array like this:
[
  { "range": "1-3", "percentage": 25, "winners": 3 },
  { "range": "4-10", "percentage": 35, "winners": 7 },
  { "range": "11-30", "percentage": 40, "winners": 20 }
]

No text. No markdown. No comments.

━━━━━━━━━━━━━━━━━━━
CORE INTELLIGENCE
━━━━━━━━━━━━━━━━━━━

1. CALCULATE AVERAGE REWARD

Average reward = Reward Pool ÷ Total Winners

Classify:

- ≤ $5 → UNFAIR
- $6–$10 → MEDIUM
- $10–$15 → FAIR
- $20–$30 → STRONG
- $50+ → EPIC

This classification CONTROLS:
- number of tiers
- depth of distribution
- first tier structure

---

2. TIER COUNT (MANDATORY)

You MUST follow:

- Winners ≤ 50:
  → 3–4 tiers
  → If UNFAIR → force 3 tiers

- Winners 60–100:
  → default 5 tiers
  → If UNFAIR or MEDIUM → reduce to 4 tiers
  → If EPIC → increase up to 6–7 tiers

- Winners > 100:
  → minimum 6 tiers
  → increase tiers gradually based on reward strength

DO NOT fix tiers at 4.

---

3. FIRST TIER STRUCTURE (CRITICAL)

You MUST design first tier intentionally:

- Default:
  → use 1–3 winners

- If reward is STRONG or EPIC:
  → 1–3 can be hierarchical (rank 1 highest)

- If reward is FAIR or below:
  → 1–3 MUST be equal split

- Use 1–5 ONLY when distribution needs broader competition
  → always equal split

- NEVER use 1–10 unless reward is low

---

4. DISTRIBUTION SHAPE

Choose ONE:

A. Competitive (top-heavy)
- Top performers earn significantly more

B. Balanced
- Mid tiers are strong
- Bottom tier smaller but still meaningful

Match this to campaign context.

---

5. NO DUST RULE (MANDATORY)

You MUST prevent meaningless rewards:

- No tier should result in extremely low payouts
- Avoid creating tiers where users earn trivial value

If average reward is low:
→ reduce tiers instead of spreading thin

---

6. WINNER DISTRIBUTION RULES

- First tier = small and exclusive
- Every tier after first must have ≥ 3 winners
- Avoid large bottom-heavy tiers
- Bottom tier must NOT exceed 40% of total winners

---

7. PERCENTAGE RULES

- Total = EXACTLY 100
- Top tier: 15–35%
- Mid tiers carry meaningful weight
- Bottom tier must be smaller than mid tiers

---

8. STRUCTURAL VALIDATION

Your output is INVALID if:
- tiers are fixed regardless of input
- distribution is flat
- bottom tier dominates
- rewards become meaningless due to over-splitting

If invalid → regenerate internally

---

━━━━━━━━━━━━━━━━━━━
FINAL RULE
━━━━━━━━━━━━━━━━━━━

Return ONLY the JSON array.
No explanation under any condition.
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

function calculateRewards(pool, tiers, totalWinners) {
  let totalPct = 0;
  let totalWinnersCheck = 0;

  for (const tier of tiers) {
    totalPct += tier.percentage;
    totalWinnersCheck += tier.winners;
  }

  // ❌ Reject invalid totals
  if (Math.abs(totalPct - 100) > 0.1) return null;
  if (totalWinnersCheck !== totalWinners) return null;

  const avgReward = pool / totalWinners;

  // 🚨 RULE 1: Tier Count Enforcement
  if (totalWinners <= 50 && tiers.length > 4) return null;
  if (totalWinners >= 60 && totalWinners <= 100 && tiers.length < 4) return null;
  if (totalWinners > 100 && tiers.length < 6) return null;

  // 🚨 RULE 2: Reject lazy 4-tier for 100 winners (your main issue)
  if (totalWinners >= 80 && totalWinners <= 100 && tiers.length === 4 && avgReward >= 10) {
    return null;
  }

  // 🚨 RULE 3: No dust rewards
  for (const tier of tiers) {
    const tierTotal = (tier.percentage / 100) * pool;
    const perUser = tierTotal / tier.winners;

    if (avgReward >= 5 && perUser < 5) {
      return null; // reject dust tiers
    }
  }

  // 🚨 RULE 4: Bottom tier control (anti farming)
  const lastTier = tiers[tiers.length - 1];
  if (lastTier.winners > totalWinners * 0.4) return null;

  // 🚨 RULE 5: Every non-first tier must have at least 3 winners
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i].winners < 3) return null;
  }

  // ✅ If passed all checks → calculate values
  return tiers.map(tier => {
    const tierTotal = (tier.percentage / 100) * pool;
    const perUser = parseFloat((tierTotal / tier.winners).toFixed(2));
    return {
      ...tier,
      tierTotal: parseFloat(tierTotal.toFixed(2)),
      perUser
    };
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
        const calculated = calculateRewards(rewardPool, parsed, winners);
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
