#!/usr/bin/env node

/**
 * Batch Screenshot Generator for n8n Workflows
 *
 * Generates screenshots of all workflows in awesome-n8n-templates
 * and commits them to Replikanti/flowlint-screenshots
 *
 * Requirements:
 * - npm install puppeteer axios glob dotenv
 * - n8n instance running (self-hosted)
 * - GitHub token with repo permissions
 * - FlowLint repo cloned locally
 */

const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { glob } = require('glob');
require('dotenv').config();

// Configuration from environment variables
const CONFIG = {
  n8nUrl: process.env.N8N_URL || 'http://localhost:5678',
  n8nApiKey: process.env.N8N_API_KEY,
  githubToken: process.env.GITHUB_TOKEN,
  githubRepo: process.env.GITHUB_SCREENSHOTS_REPO || 'your-org/your-screenshots-repo',
  screenshotsDir: './screenshots',
  workflowsDir: process.env.WORKFLOWS_DIR || '.',

  // n8n Authentication
  n8nBasicAuthUser: process.env.N8N_BASIC_AUTH_USER,
  n8nBasicAuthPassword: process.env.N8N_BASIC_AUTH_PASSWORD,
  n8nEmail: process.env.N8N_EMAIL,
  n8nPassword: process.env.N8N_PASSWORD,

  // Screenshot settings
  viewport: {
    width: 1920,
    height: 1080,
  },
  screenshotQuality: 90,

  // Delays (ms)
  delayAfterImport: 2000,
  delayAfterPageLoad: 5000, // Increased from 3s to 5s
  delayBetweenWorkflows: 1000,

  // Batch processing
  batchSize: 10, // Process 10 workflows, then commit
  skipExisting: true, // Skip if screenshot already exists in GitHub

  // Debug
  debug: process.env.DEBUG === 'true',
};

// State tracking
const state = {
  total: 0,
  processed: 0,
  succeeded: 0,
  failed: 0,
  skipped: 0,
  errors: [],
};

// Logging utilities
const log = {
  info: (msg) => console.log(`ℹ️  ${msg}`),
  success: (msg) => console.log(`✅ ${msg}`),
  error: (msg) => console.error(`❌ ${msg}`),
  warn: (msg) => console.warn(`⚠️  ${msg}`),
  progress: () => console.log(`📊 Progress: ${state.processed}/${state.total} (${state.succeeded} ✅, ${state.failed} ❌, ${state.skipped} ⏭️)`),
};

/**
 * Get all workflow JSON files
 */
async function getWorkflowFiles() {
  const pattern = path.join(CONFIG.workflowsDir, '**/*.json');
  const files = await glob(pattern, {
    ignore: [
      '**/node_modules/**',
      '**/.git/**',
      '**/package*.json',
    ],
  });

  return files.filter(file => {
    // Filter out non-workflow JSONs
    try {
      const content = JSON.parse(fs.readFileSync(file, 'utf8'));
      return content.nodes && content.name;
    } catch (e) {
      return false;
    }
  });
}

/**
 * Convert workflow filename to screenshot filename
 */
function getScreenshotFilename(workflowPath) {
  const basename = path.basename(workflowPath, '.json');
  return basename
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50) + '.png';
}

/**
 * Get category from file path
 */
function getCategory(workflowPath) {
  const parts = workflowPath.split(path.sep);
  // Find category directory (parent of the JSON file)
  for (let i = parts.length - 2; i >= 0; i--) {
    const dir = parts[i];
    if (dir.includes('_') || dir === 'devops') {
      return dir;
    }
  }
  return 'Other_Integrations_and_Use_Cases';
}

/**
 * Check if screenshot already exists in GitHub
 */
async function screenshotExists(category, filename) {
  if (!CONFIG.skipExisting) return false;

  try {
    const url = `https://api.github.com/repos/${CONFIG.githubRepo}/contents/screenshots/${category}/${filename}`;
    const response = await axios.get(url, {
      headers: {
        'Authorization': `token ${CONFIG.githubToken}`,
        'Accept': 'application/vnd.github.v3+json',
      },
      validateStatus: (status) => status === 200 || status === 404,
    });

    return response.status === 200;
  } catch (error) {
    return false;
  }
}

/**
 * Import workflow to n8n
 */
async function importWorkflow(workflowJson) {
  try {
    if (CONFIG.debug) {
      log.info(`  API endpoint: ${CONFIG.n8nUrl}/api/v1/workflows`);
      log.info(`  Using API key: ${CONFIG.n8nApiKey ? 'Yes' : 'No'}`);
    }

    // Clean workflow JSON - remove properties that API doesn't accept
    const cleanWorkflow = {
      name: workflowJson.name,
      nodes: workflowJson.nodes,
      connections: workflowJson.connections,
      settings: workflowJson.settings || {},
    };

    // Optionally include staticData if present
    if (workflowJson.staticData) {
      cleanWorkflow.staticData = workflowJson.staticData;
    }

    const response = await axios.post(
      `${CONFIG.n8nUrl}/api/v1/workflows`,
      cleanWorkflow,
      {
        headers: {
          'X-N8N-API-KEY': CONFIG.n8nApiKey,
          'Content-Type': 'application/json',
        },
        validateStatus: (status) => status < 500, // Don't throw on 4xx
      }
    );

    if (CONFIG.debug) {
      log.info(`  API response status: ${response.status}`);
      log.info(`  API response data: ${JSON.stringify(response.data).substring(0, 200)}...`);
    }

    if (response.status >= 400) {
      throw new Error(`API returned ${response.status}: ${JSON.stringify(response.data)}`);
    }

    const workflowId = response.data.id || response.data.data?.id;

    if (!workflowId) {
      throw new Error(`No workflow ID in response: ${JSON.stringify(response.data)}`);
    }

    if (CONFIG.debug) {
      log.info(`  Imported workflow ID: ${workflowId}`);
    }

    return workflowId;
  } catch (error) {
    if (error.response) {
      throw new Error(`Failed to import workflow: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
    }
    throw new Error(`Failed to import workflow: ${error.message}`);
  }
}

/**
 * Delete workflow from n8n
 */
async function deleteWorkflow(workflowId) {
  try {
    await axios.delete(
      `${CONFIG.n8nUrl}/api/v1/workflows/${workflowId}`,
      {
        headers: {
          'X-N8N-API-KEY': CONFIG.n8nApiKey,
        },
      }
    );
  } catch (error) {
    log.warn(`Failed to delete workflow ${workflowId}: ${error.message}`);
  }
}

/**
 * Login to n8n if credentials provided
 */
async function loginToN8n(page) {
  // Use n8n login form with email/password
  if (CONFIG.n8nEmail && CONFIG.n8nPassword) {
    try {
      log.info('Logging in to n8n...');
      await page.goto(`${CONFIG.n8nUrl}/signin`, { waitUntil: 'networkidle2', timeout: 15000 });

      // Wait for login form
      await page.waitForSelector('input[type="email"]', { timeout: 5000 });

      // Debug: Save login page HTML
      if (CONFIG.debug) {
        const html = await page.content();
        fs.writeFileSync('debug-login-page.html', html);
        log.info('  Debug: Login page HTML saved to debug-login-page.html');
      }

      // Fill in credentials
      await page.type('input[type="email"]', CONFIG.n8nEmail);
      await page.type('input[type="password"]', CONFIG.n8nPassword);

      // Wait a bit for form validation
      await new Promise(resolve => setTimeout(resolve, 500));

      // Find and click submit button by text content
      const clicked = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const signInButton = buttons.find(btn =>
          btn.textContent?.trim() === 'Sign in' &&
          btn.type === 'submit' &&
          !btn.disabled &&
          btn.offsetParent !== null // visible check
        );

        if (signInButton) {
          signInButton.click();
          return true;
        }
        return false;
      });

      if (!clicked) {
        // Debug: show all buttons
        const buttons = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          return btns.map(btn => ({
            text: btn.textContent?.trim(),
            type: btn.type,
            disabled: btn.disabled,
            visible: btn.offsetParent !== null,
          }));
        });

        log.error('  Available buttons:');
        buttons.forEach(btn => {
          log.error(`    - "${btn.text}" type=${btn.type} disabled=${btn.disabled} visible=${btn.visible}`);
        });

        throw new Error('Could not find "Sign in" submit button');
      }

      if (CONFIG.debug) {
        log.info('  Clicked "Sign in" button');
      }

      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 });

      log.info('✅ Logged in successfully');
    } catch (e) {
      log.warn(`Login attempt failed: ${e.message}`);
      throw e;
    }
  } else if (CONFIG.n8nBasicAuthUser && CONFIG.n8nBasicAuthPassword) {
    // HTTP Basic Auth (if server uses it)
    await page.authenticate({
      username: CONFIG.n8nBasicAuthUser,
      password: CONFIG.n8nBasicAuthPassword,
    });
    log.info('Using HTTP Basic Auth');
  } else {
    log.warn('No n8n credentials provided - screenshots may fail if auth is required');
  }
}

/**
 * Take screenshot of workflow
 */
async function takeScreenshot(workflowId, browser) {
  const page = await browser.newPage();

  try {
    await page.setViewport(CONFIG.viewport);

    // Navigate to workflow (browser already logged in)
    const url = `${CONFIG.n8nUrl}/workflow/${workflowId}`;

    if (CONFIG.debug) {
      log.info(`  Navigating to: ${url}`);
    }

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Debug: Save page HTML if debug mode
    if (CONFIG.debug) {
      const html = await page.content();
      fs.writeFileSync(`debug-page-${workflowId}.html`, html);
      log.info(`  Debug HTML saved to debug-page-${workflowId}.html`);
    }

    // Wait for canvas to load - try multiple selectors
    const selectors = [
      '.node-view',
      '[data-test-id="canvas"]',
      '.canvas-container',
      '#canvas',
      'canvas',
    ];

    let selectorFound = null;
    for (const selector of selectors) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        selectorFound = selector;
        if (CONFIG.debug) {
          log.info(`  Found selector: ${selector}`);
        }
        break;
      } catch (e) {
        // Try next selector
      }
    }

    if (!selectorFound) {
      // Debug: Take screenshot of what we see
      if (CONFIG.debug) {
        const debugScreenshot = await page.screenshot({ type: 'png' });
        fs.writeFileSync(`debug-screenshot-${workflowId}.png`, debugScreenshot);
        log.info(`  Debug screenshot saved to debug-screenshot-${workflowId}.png`);
      }
      throw new Error('Could not find workflow canvas element');
    }

    // Additional wait for rendering
    await new Promise(resolve => setTimeout(resolve, CONFIG.delayAfterPageLoad));

    // Try to click "Fit to view" button if exists
    try {
      await page.evaluate(() => {
        const fitButton = document.querySelector('[data-test-id="zoom-to-fit"]') ||
                         document.querySelector('.zoom-to-fit') ||
                         document.querySelector('button[title*="fit" i]');
        if (fitButton) fitButton.click();
      });
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (e) {
      // Fit button not found, that's ok
    }

    // Take screenshot
    const screenshot = await page.screenshot({
      type: 'png',
      fullPage: false,
    });

    return screenshot;
  } finally {
    await page.close();
  }
}

/**
 * Upload screenshot to GitHub
 */
async function uploadToGitHub(category, filename, imageBuffer) {
  const base64Content = imageBuffer.toString('base64');
  const filePath = `screenshots/${category}/${filename}`;

  try {
    // Check if file exists (to get SHA for update)
    let sha = null;
    try {
      const existingFile = await axios.get(
        `https://api.github.com/repos/${CONFIG.githubRepo}/contents/${filePath}`,
        {
          headers: {
            'Authorization': `token ${CONFIG.githubToken}`,
            'Accept': 'application/vnd.github.v3+json',
          },
        }
      );
      sha = existingFile.data.sha;
    } catch (e) {
      // File doesn't exist, that's ok
    }

    // Upload or update
    const payload = {
      message: `Add screenshot: ${filename}`,
      content: base64Content,
      branch: 'main',
    };

    if (sha) {
      payload.sha = sha;
      payload.message = `Update screenshot: ${filename}`;
    }

    await axios.put(
      `https://api.github.com/repos/${CONFIG.githubRepo}/contents/${filePath}`,
      payload,
      {
        headers: {
          'Authorization': `token ${CONFIG.githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      }
    );

    const publicUrl = `https://raw.githubusercontent.com/${CONFIG.githubRepo}/main/${filePath}`;
    return publicUrl;
  } catch (error) {
    throw new Error(`GitHub upload failed: ${error.message}`);
  }
}

/**
 * Process single workflow
 */
async function processWorkflow(workflowPath, browser) {
  const workflowName = path.basename(workflowPath);
  const category = getCategory(workflowPath);
  const filename = getScreenshotFilename(workflowPath);

  log.info(`Processing: ${workflowName}`);
  log.info(`  Category: ${category}`);
  log.info(`  Output: ${filename}`);

  // Check if already exists
  if (await screenshotExists(category, filename)) {
    log.warn(`  Skipping: Screenshot already exists`);
    state.skipped++;
    return null;
  }

  let workflowId = null;

  try {
    // Read workflow JSON
    const workflowJson = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

    // Import to n8n
    log.info(`  Importing to n8n...`);
    workflowId = await importWorkflow(workflowJson);
    await new Promise(resolve => setTimeout(resolve, CONFIG.delayAfterImport));

    // Take screenshot
    log.info(`  Taking screenshot...`);
    const screenshot = await takeScreenshot(workflowId, browser);

    // Save locally (optional backup)
    const localDir = path.join(CONFIG.screenshotsDir, category);
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }
    const localPath = path.join(localDir, filename);
    fs.writeFileSync(localPath, screenshot);

    // Upload to GitHub
    log.info(`  Uploading to GitHub...`);
    const url = await uploadToGitHub(category, filename, screenshot);

    log.success(`  Success! ${url}`);
    state.succeeded++;

    return {
      workflow: workflowName,
      category,
      filename,
      url,
    };
  } catch (error) {
    log.error(`  Failed: ${error.message}`);
    state.failed++;
    state.errors.push({
      workflow: workflowName,
      error: error.message,
    });
    return null;
  } finally {
    // Cleanup: delete from n8n
    if (workflowId) {
      await deleteWorkflow(workflowId);
    }

    state.processed++;
    log.progress();
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('🚀 n8n Workflow Screenshot Generator\n');

  // Validate config
  if (!CONFIG.n8nApiKey) {
    log.error('Missing N8N_API_KEY environment variable');
    process.exit(1);
  }
  if (!CONFIG.githubToken) {
    log.error('Missing GITHUB_TOKEN environment variable');
    process.exit(1);
  }
  if (!CONFIG.githubRepo || CONFIG.githubRepo === 'your-org/your-screenshots-repo') {
    log.error('Missing or invalid GITHUB_SCREENSHOTS_REPO environment variable');
    log.error('Please set it to your target repository in format: owner/repo');
    process.exit(1);
  }

  log.info(`n8n URL: ${CONFIG.n8nUrl}`);
  log.info(`GitHub Repo: ${CONFIG.githubRepo}`);
  log.info(`Workflows Dir: ${CONFIG.workflowsDir}`);
  log.info(`Screenshots Dir: ${CONFIG.screenshotsDir}`);
  console.log('');

  // Get all workflows
  log.info('Finding workflow files...');
  const workflowFiles = await getWorkflowFiles();
  state.total = workflowFiles.length;
  log.info(`Found ${state.total} workflows\n`);

  if (state.total === 0) {
    log.warn('No workflow files found!');
    return;
  }

  // Launch browser
  log.info('Launching browser...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    // Login once at the beginning
    if (CONFIG.n8nEmail && CONFIG.n8nPassword) {
      const loginPage = await browser.newPage();
      await loginToN8n(loginPage);
      await loginPage.close();
      console.log('');
    }

    // Process workflows
    const results = [];

    for (let i = 0; i < workflowFiles.length; i++) {
      const workflowPath = workflowFiles[i];
      const result = await processWorkflow(workflowPath, browser);

      if (result) {
        results.push(result);
      }

      // Delay between workflows
      if (i < workflowFiles.length - 1) {
        await new Promise(resolve => setTimeout(resolve, CONFIG.delayBetweenWorkflows));
      }
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 SUMMARY');
    console.log('='.repeat(60));
    log.info(`Total workflows: ${state.total}`);
    log.success(`Successfully processed: ${state.succeeded}`);
    log.error(`Failed: ${state.failed}`);
    log.warn(`Skipped (already exist): ${state.skipped}`);

    if (state.errors.length > 0) {
      console.log('\n❌ Errors:');
      state.errors.forEach(({ workflow, error }) => {
        console.log(`  - ${workflow}: ${error}`);
      });
    }

    // Save results to JSON
    const resultsFile = 'screenshot-results.json';
    fs.writeFileSync(resultsFile, JSON.stringify({
      timestamp: new Date().toISOString(),
      stats: {
        total: state.total,
        succeeded: state.succeeded,
        failed: state.failed,
        skipped: state.skipped,
      },
      screenshots: results,
      errors: state.errors,
    }, null, 2));

    log.success(`\nResults saved to ${resultsFile}`);

  } finally {
    await browser.close();
    log.info('Browser closed');
  }
}

// Run
main().catch(error => {
  log.error(`Fatal error: ${error.message}`);
  console.error(error);
  process.exit(1);
});
