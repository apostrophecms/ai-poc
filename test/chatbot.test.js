import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import createApos from '../project.js';

// Test timeout - AI responses can take a while, especially with rate limiting
const TEST_TIMEOUT = 300000; // 5 minutes per it()
const POLL_INTERVAL = 500;
const MAX_POLL_ATTEMPTS = 200;

// Check for required API key
if (!process.env.APOS_ANTHROPIC_API_KEY) {
  console.error('ERROR: APOS_ANTHROPIC_API_KEY environment variable is required');
  console.error('Run with: APOS_ANTHROPIC_API_KEY=your-key npm test');
  process.exit(1);
}

// Schema format comparison tracking
const schemaFormatResults = {
  compact: { inputTokens: 0, outputTokens: 0 },
  json: { inputTokens: 0, outputTokens: 0 }
};

describe('Chatbot Schema Format Comparison', function () {
  let apos;
  let jar;
  let testArticleId;
  let testUserId;
  let testImageId;
  let testAttachmentId;

  // Token tracking - reset between format runs
  let runInputTokens = 0;
  let runOutputTokens = 0;

  this.timeout(TEST_TIMEOUT);

  before(async function () {
    apos = await createApos({
      shortName: 'test-chatbot',
      baseUrl: 'http://localhost:3333',
      autoBuild: false,
      argv: { _: [] },
      modules: {
        '@apostrophecms/express': {
          options: {
            session: { secret: 'test-secret' },
            port: 3333
          }
        }
      }
    });

    // Create test admin user
    const userModule = apos.modules['@apostrophecms/user'];
    const req = apos.task.getReq();

    const existingUser = await userModule.find(req, { username: 'testadmin' }).toObject();
    if (existingUser) {
      await apos.doc.db.deleteMany({ aposDocId: existingUser.aposDocId });
    }
    await apos.modules['@apostrophecms/user'].safe.deleteMany({ username: 'testadmin' });

    const user = await userModule.insert(req, {
      username: 'testadmin',
      password: 'testpassword123',
      title: 'Test Admin',
      role: 'admin'
    });
    testUserId = user._id;

    jar = apos.http.jar();
    await apos.http.get('/', { jar });

    await apos.http.post('/api/v1/@apostrophecms/login/login', {
      body: {
        username: 'testadmin',
        password: 'testpassword123',
        session: true
      },
      jar
    });

    await createTestStarImage(req);

    console.log('Test setup complete.');
  });

  async function createTestStarImage(req) {
    const pngBuffer = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
      0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
      0x54, 0x08, 0xD7, 0x63, 0xF8, 0xFF, 0xFF, 0x3F,
      0x00, 0x05, 0xFE, 0x02, 0xFE, 0xDC, 0xCC, 0x59,
      0xE7, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
      0x44, 0xAE, 0x42, 0x60, 0x82
    ]);

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const tempPath = path.join(__dirname, 'temp-star.png');
    fs.writeFileSync(tempPath, pngBuffer);

    try {
      const attachment = await apos.attachment.insert(req, {
        name: 'star.png',
        path: tempPath
      });
      testAttachmentId = attachment._id;

      const imageModule = apos.modules['@apostrophecms/image'];
      const image = await imageModule.insert(req, {
        title: 'Star Image for Testing',
        slug: 'test-star-image-' + Date.now(),
        attachment
      });
      testImageId = image._id;
    } finally {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    }
  }

  after(async function () {
    // Print final comparison
    console.log('\n========================================');
    console.log('FINAL SCHEMA FORMAT COMPARISON');
    console.log('========================================');
    const inputDiff = schemaFormatResults.json.inputTokens - schemaFormatResults.compact.inputTokens;
    const totalCompact = schemaFormatResults.compact.inputTokens + schemaFormatResults.compact.outputTokens;
    const totalJson = schemaFormatResults.json.inputTokens + schemaFormatResults.json.outputTokens;
    const inputSavingsPercent = schemaFormatResults.json.inputTokens > 0
      ? ((inputDiff / schemaFormatResults.json.inputTokens) * 100).toFixed(1)
      : '0';
    const totalSavingsPercent = totalJson > 0
      ? (((totalJson - totalCompact) / totalJson) * 100).toFixed(1)
      : '0';

    console.log(`Compact: ${schemaFormatResults.compact.inputTokens.toLocaleString()} input, ${schemaFormatResults.compact.outputTokens.toLocaleString()} output (${totalCompact.toLocaleString()} total)`);
    console.log(`JSON:    ${schemaFormatResults.json.inputTokens.toLocaleString()} input, ${schemaFormatResults.json.outputTokens.toLocaleString()} output (${totalJson.toLocaleString()} total)`);
    console.log(`Input token savings: ${inputDiff.toLocaleString()} (${inputSavingsPercent}% reduction)`);
    console.log(`Total token savings: ${(totalJson - totalCompact).toLocaleString()} (${totalSavingsPercent}% reduction)`);
    console.log('========================================\n');

    if (apos) {
      try {
        if (testImageId) {
          const aposDocId = testImageId.replace(/:.*$/, '');
          await apos.doc.db.deleteMany({ aposDocId });
        }
        if (testArticleId) {
          const aposDocId = testArticleId.replace(/:.*$/, '');
          await apos.doc.db.deleteMany({ aposDocId });
        }
        if (testUserId) {
          const aposDocId = testUserId.replace(/:.*$/, '');
          await apos.doc.db.deleteMany({ aposDocId });
        }
        await apos.modules['@apostrophecms/user'].safe.deleteMany({ username: 'testadmin' });
        await apos.db.collection('aposChatbotMessages').deleteMany({});
        if (testAttachmentId) {
          await apos.attachment.db.deleteMany({ _id: testAttachmentId });
        }
      } catch (e) {
        console.error('Cleanup error:', e.message);
      }
      await apos.destroy();
    }
  });

  function generateId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  async function sendChatMessage(message, contextDoc, chatId) {
    const messageId = generateId();
    chatId = chatId || generateId();

    let lastKnownInputTokens = 0;
    let lastKnownOutputTokens = 0;

    await apos.http.post('/api/v1/chatbot/chat', {
      body: { message, messageId, chatId },
      jar
    });

    let lastIndex = 0;
    let attempts = 0;
    const responses = [];

    while (attempts < MAX_POLL_ATTEMPTS) {
      attempts++;

      const pollResult = await apos.http.get('/api/v1/chatbot/poll', {
        qs: { messageId, lastIndex },
        jar
      });

      if (pollResult.tokenUsage) {
        const inputDelta = pollResult.tokenUsage.inputTokens - lastKnownInputTokens;
        const outputDelta = pollResult.tokenUsage.outputTokens - lastKnownOutputTokens;
        if (inputDelta > 0) {
          runInputTokens += inputDelta;
          lastKnownInputTokens = pollResult.tokenUsage.inputTokens;
        }
        if (outputDelta > 0) {
          runOutputTokens += outputDelta;
          lastKnownOutputTokens = pollResult.tokenUsage.outputTokens;
        }
      }

      if (pollResult.pendingAction) {
        const result = await executeAction(pollResult.pendingAction, contextDoc);
        await apos.http.post('/api/v1/chatbot/action-result', {
          body: { messageId, result },
          jar
        });
      }

      for (const resp of pollResult.responses) {
        responses.push(resp);
        lastIndex++;
        if (resp.final) {
          return { responses, finalText: resp.text };
        }
      }

      await delay(POLL_INTERVAL);
    }

    throw new Error('Timeout waiting for chat response');
  }

  // Extract only core properties to minimize token usage
  function toCoreProperties(doc) {
    if (!doc) {
      return doc;
    }
    return {
      _id: doc._id,
      aposDocId: doc.aposDocId,
      type: doc.type,
      title: doc.title,
      slug: doc.slug
    };
  }

  async function executeAction(action, contextDoc) {
    if (action.type === 'search') {
      const result = await apos.http.get('/api/v1/chatbot/search', {
        qs: { q: action.query, aposMode: 'draft' },
        jar
      });
      // Return only core properties to save tokens
      return {
        total: result.results.length,
        results: result.results.map(doc => toCoreProperties(doc))
      };
    }

    if (action.type === 'get-context') {
      if (!contextDoc) {
        return { error: 'No context document available' };
      }
      const doc = await apos.http.get(`/api/v1/${contextDoc.type}/${contextDoc._id}`, {
        qs: { aposMode: 'draft' },
        jar
      });
      // Return only core properties to save tokens
      return toCoreProperties(doc);
    }

    if (action.type === 'update') {
      const url = `/api/v1/${action.docType}/${action._id}?aposMode=draft`;
      console.log('[test] PATCH', url);
      console.log('[test] PATCH body:', JSON.stringify(action.updates, null, 2));
      await apos.http.patch(`/api/v1/${action.docType}/${action._id}`, {
        qs: { aposMode: 'draft' },
        body: action.updates,
        jar
      });
      return { success: true };
    }

    if (action.type === 'add-widget') {
      const currentDoc = await apos.http.get(`/api/v1/${action.docType}/${action.docId}`, {
        qs: { aposMode: 'draft' },
        jar
      });
      const area = findAreaById(currentDoc, action.areaId);
      if (!area) {
        return { error: `Area not found: ${action.areaId}` };
      }
      const items = area.items || [];
      if (action.position === 'end' || action.position >= items.length) {
        items.push(action.widget);
      } else {
        items.splice(action.position, 0, action.widget);
      }
      area.items = items;
      const url = `/api/v1/${action.docType}/${action.docId}?aposMode=draft`;
      const patch = { [`@${action.areaId}`]: area };
      console.log('[test] PATCH', url);
      console.log('[test] PATCH body:', JSON.stringify(patch, null, 2));
      await apos.http.patch(`/api/v1/${action.docType}/${action.docId}`, {
        qs: { aposMode: 'draft' },
        body: patch,
        jar
      });
      return { success: true, widgetId: action.widget._id };
    }

    if (action.type === 'delete-widget') {
      const currentDoc = await apos.http.get(`/api/v1/${action.docType}/${action.docId}`, {
        qs: { aposMode: 'draft' },
        jar
      });
      const result = findAndRemoveWidget(currentDoc, action.widgetId);
      if (!result) {
        return { error: `Widget not found: ${action.widgetId}` };
      }
      const url = `/api/v1/${action.docType}/${action.docId}?aposMode=draft`;
      const patch = { [`@${result.areaId}`]: result.area };
      console.log('[test] PATCH', url);
      console.log('[test] PATCH body:', JSON.stringify(patch, null, 2));
      await apos.http.patch(`/api/v1/${action.docType}/${action.docId}`, {
        qs: { aposMode: 'draft' },
        body: patch,
        jar
      });
      return { success: true, deletedWidgetId: action.widgetId };
    }

    return { error: `Unknown action type: ${action.type}` };
  }

  // Find a widget by _id and remove it from its parent area
  function findAndRemoveWidget(obj, widgetId) {
    if (!obj || typeof obj !== 'object') return null;

    // Check if this is an area
    if (obj.metaType === 'area' && Array.isArray(obj.items)) {
      const index = obj.items.findIndex(item => item._id === widgetId);
      if (index !== -1) {
        obj.items.splice(index, 1);
        return { area: obj, areaId: obj._id };
      }
      for (const item of obj.items) {
        const result = findAndRemoveWidget(item, widgetId);
        if (result) return result;
      }
    }

    for (const key of Object.keys(obj)) {
      const value = obj[key];
      if (value && typeof value === 'object') {
        const result = findAndRemoveWidget(value, widgetId);
        if (result) return result;
      }
    }
    return null;
  }

  function findAreaById(obj, areaId) {
    if (!obj || typeof obj !== 'object') return null;
    if (obj._id === areaId && obj.metaType === 'area') return obj;
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      if (Array.isArray(value)) {
        for (const item of value) {
          const found = findAreaById(item, areaId);
          if (found) return found;
        }
      } else if (value && typeof value === 'object') {
        const found = findAreaById(value, areaId);
        if (found) return found;
      }
    }
    return null;
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function getTestArticle() {
    return await apos.http.get(`/api/v1/article/${testArticleId}`, {
      qs: { aposMode: 'draft' },
      jar
    });
  }

  async function createFreshArticle() {
    const req = apos.task.getReq();
    const articleModule = apos.modules.article;

    // Clean up existing test article if any
    if (testArticleId) {
      const aposDocId = testArticleId.replace(/:.*$/, '');
      await apos.doc.db.deleteMany({ aposDocId });
    }

    // Create fresh article
    const article = await articleModule.insert(req, {
      title: 'TEST-CHATBOT-ARTICLE-DO-NOT-USE',
      slug: 'test-chatbot-article-' + Date.now(),
      main: {
        metaType: 'area',
        _id: apos.util.generateId(),
        items: []
      }
    });
    testArticleId = article._id;
    return article;
  }

  // Run all test scenarios and return results
  async function runAllScenarios(formatName) {
    const chatId = generateId();
    const contextDoc = { _id: testArticleId, type: 'article' };

    console.log(`\n  [${formatName}] Running scenario: cats paragraph`);
    await sendChatMessage(
      'Add a paragraph of nice things about cats. You must include the word "whiskers" in your text.',
      contextDoc,
      chatId
    );

    // Verify cats
    let article = await getTestArticle();
    const richTextWidget = article.main?.items?.find(
      item => item.type === '@apostrophecms/rich-text' && item.content
    );
    assert.ok(richTextWidget, `[${formatName}] Should have a rich-text widget`);
    assert.ok(
      richTextWidget.content.toLowerCase().includes('whiskers'),
      `[${formatName}] Content should include "whiskers"`
    );

    console.log(`  [${formatName}] Running scenario: two-column layout`);
    await sendChatMessage(
      'Switch to a two-column layout, with "Point" and "Counterpoint" headings. Move the existing text to the "Point" column. Write your own "Counterpoint" text that must include the word "however".',
      contextDoc,
      chatId
    );

    // Verify layout
    article = await getTestArticle();
    const layoutWidget = article.main?.items?.find(item => item.type === '@apostrophecms/layout');
    assert.ok(layoutWidget, `[${formatName}] Should have a layout widget`);
    assert.ok(layoutWidget.columns?.items?.length >= 2, `[${formatName}] Layout should have at least 2 columns`);

    let foundWhiskers = false;
    let foundHowever = false;
    function searchContent(obj) {
      if (!obj) return;
      if (typeof obj === 'string') {
        if (obj.toLowerCase().includes('whiskers')) foundWhiskers = true;
        if (obj.toLowerCase().includes('however')) foundHowever = true;
      }
      if (typeof obj === 'object') {
        for (const value of Object.values(obj)) {
          searchContent(value);
        }
      }
    }
    searchContent(layoutWidget);
    assert.ok(foundWhiskers, `[${formatName}] Original "whiskers" text should be preserved`);
    assert.ok(foundHowever, `[${formatName}] Counterpoint should include "however"`);

    console.log(`  [${formatName}] Running scenario: bulleted lists`);
    await sendChatMessage('Now change the text to bulleted lists.', contextDoc, chatId);

    // Verify lists
    article = await getTestArticle();
    let foundBulletList = false;
    function searchForLists(obj) {
      if (!obj) return;
      if (typeof obj === 'string' && (obj.includes('<ul>') || obj.includes('<li>'))) {
        foundBulletList = true;
      }
      if (typeof obj === 'object') {
        for (const value of Object.values(obj)) {
          searchForLists(value);
        }
      }
    }
    searchForLists(article.main);
    assert.ok(foundBulletList, `[${formatName}] Content should have bulleted lists`);

    console.log(`  [${formatName}] Running scenario: add star image`);
    await sendChatMessage('Now add an image of a star.', contextDoc, chatId);

    // Verify image widget exists (relationship population is a known issue)
    article = await getTestArticle();
    let imageWidget = null;
    function findImageWidget(obj) {
      if (!obj) return;
      if (obj.type === '@apostrophecms/image') {
        imageWidget = obj;
        return;
      }
      if (typeof obj === 'object') {
        for (const value of Object.values(obj)) {
          if (imageWidget) return;
          findImageWidget(value);
        }
      }
    }
    findImageWidget(article.main);
    assert.ok(imageWidget, `[${formatName}] Should have an image widget`);

    console.log(`  [${formatName}] Running scenario: add gap between columns`);
    await sendChatMessage('Add a gap between the columns.', contextDoc, chatId);

    // Verify gap
    article = await getTestArticle();
    const finalLayout = article.main?.items?.find(item => item.type === '@apostrophecms/layout');
    assert.ok(finalLayout, `[${formatName}] Should still have a layout widget`);
    const columns = finalLayout.columns?.items;
    assert.ok(columns?.length >= 2, `[${formatName}] Layout should have at least 2 columns`);

    const col1 = columns[0];
    const col2 = columns[1];
    assert.ok(col1.desktop && col2.desktop, `[${formatName}] Columns should have desktop settings`);

    const col1End = col1.desktop.colstart + col1.desktop.colspan;
    const col2Start = col2.desktop.colstart;
    assert.ok(
      col2Start > col1End,
      `[${formatName}] Second column should start after first column ends (gap). ` +
      `Col1 ends at ${col1End}, Col2 starts at ${col2Start}`
    );
  }

  describe('Compact schema format', function () {
    before(async function () {
      console.log('\n========================================');
      console.log('TESTING: COMPACT SCHEMA FORMAT');
      console.log('========================================');
      apos.modules.chatbot.options.compactSchema = true;
      runInputTokens = 0;
      runOutputTokens = 0;
      await apos.db.collection('aposChatbotMessages').deleteMany({});
      await createFreshArticle();
    });

    after(function () {
      schemaFormatResults.compact = {
        inputTokens: runInputTokens,
        outputTokens: runOutputTokens
      };
      console.log(`\n  Compact format totals: ${runInputTokens.toLocaleString()} input, ${runOutputTokens.toLocaleString()} output tokens`);
    });

    it('should complete all scenarios with compact schema format', async function () {
      await runAllScenarios('COMPACT');
    });
  });

  describe('JSON schema format', function () {
    before(async function () {
      console.log('\n========================================');
      console.log('TESTING: JSON SCHEMA FORMAT');
      console.log('========================================');
      apos.modules.chatbot.options.compactSchema = false;
      runInputTokens = 0;
      runOutputTokens = 0;
      await apos.db.collection('aposChatbotMessages').deleteMany({});
      await createFreshArticle();
    });

    after(function () {
      schemaFormatResults.json = {
        inputTokens: runInputTokens,
        outputTokens: runOutputTokens
      };
      console.log(`\n  JSON format totals: ${runInputTokens.toLocaleString()} input, ${runOutputTokens.toLocaleString()} output tokens`);
    });

    it('should complete all scenarios with JSON schema format', async function () {
      await runAllScenarios('JSON');
    });
  });
});
