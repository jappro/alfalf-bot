const Database = require('better-sqlite3');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const db = new Database(path.join(__dirname, 'alfalf.db'));

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    project_name TEXT,
    goal TEXT,
    duration TEXT,
    project_type TEXT,
    platform TEXT,
    campaign_output TEXT,
    campaign_score REAL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS rewards (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    reward_pool REAL,
    total_winners INTEGER,
    distribution_json TEXT,
    calculated_breakdown TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
  );

  CREATE TABLE IF NOT EXISTS refinements (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    type TEXT,
    input_context TEXT,
    output TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
  );
`);

function createCampaign(data) {
  const id = uuidv4();
  const stmt = db.prepare(`
    INSERT INTO campaigns (id, user_id, project_name, goal, duration, project_type, platform, campaign_output, campaign_score)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, data.userId, data.projectName, data.goal, data.duration, data.projectType, data.platform, data.campaignOutput, data.campaignScore || null);
  return id;
}

function getCampaign(id) {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
  if (!campaign) return null;
  const reward = db.prepare('SELECT * FROM rewards WHERE campaign_id = ? ORDER BY created_at DESC LIMIT 1').get(id);
  const refinements = db.prepare('SELECT * FROM refinements WHERE campaign_id = ? ORDER BY created_at DESC').all(id);
  return { campaign, reward, refinements };
}

function getCampaignsByUser(userId) {
  return db.prepare('SELECT * FROM campaigns WHERE user_id = ? ORDER BY created_at DESC').all(userId);
}

function saveReward(campaignId, data) {
  const id = uuidv4();
  const stmt = db.prepare(`
    INSERT INTO rewards (id, campaign_id, reward_pool, total_winners, distribution_json, calculated_breakdown)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, campaignId, data.rewardPool, data.totalWinners, JSON.stringify(data.distributionJson), JSON.stringify(data.calculatedBreakdown));
  return id;
}

function saveRefinement(campaignId, data) {
  const id = uuidv4();
  const stmt = db.prepare(`
    INSERT INTO refinements (id, campaign_id, type, input_context, output)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(id, campaignId, data.type, data.inputContext, data.output);
  return id;
}

function updateCampaignScore(id, score) {
  db.prepare(`UPDATE campaigns SET campaign_score = ?, updated_at = datetime('now') WHERE id = ?`).run(score, id);
}

module.exports = { createCampaign, getCampaign, getCampaignsByUser, saveReward, saveRefinement, updateCampaignScore };
