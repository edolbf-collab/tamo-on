// Exercise repository HTML and CSS with Chromium's actual safe-area variables.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');

async function checkBounds(page, selector, viewport, insets) {
  const items = page.locator(selector);
  const count = await items.count();
  assert.ok(count > 0, selector);
  for (let i = 0; i < count; i++) {
    const box = await items.nth(i).boundingBox();
    assert.ok(box && box.x >= insets.left - 1 && box.x + box.width <= viewport.width - insets.right + 1
      && box.y >= insets.top - 1 && box.y + box.height <= viewport.height - insets.bottom + 1,
    selector + ' outside the safe area: ' + JSON.stringify({ box, viewport, insets }));
  }
}

async function main() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ isMobile: true, hasTouch: true });
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      const type = route.request().resourceType();
      if (url.origin !== 'https://tamo.test' || !['document', 'stylesheet'].includes(type)) return route.abort();
      const body = await fs.readFile(path.join(root, url.pathname));
      return route.fulfill({ contentType: type === 'document' ? 'text/html' : 'text/css', body });
    });
    const session = await page.context().newCDPSession(page);
    const cases = [
      { viewport: { width: 390, height: 844 }, insets: { top: 36, bottom: 32, left: 0, right: 0 } },
      { viewport: { width: 844, height: 390 }, insets: { top: 12, bottom: 24, left: 52, right: 12 } },
      { viewport: { width: 844, height: 390 }, insets: { top: 12, bottom: 24, left: 12, right: 52 } }
    ];
    for (const { viewport, insets } of cases) {
      await page.setViewportSize(viewport);
      await page.goto('https://tamo.test/index.html');
      await session.send('Emulation.setSafeAreaInsetsOverride', { insets });
      await checkBounds(page, '#profileButton, .bottom-nav button', viewport, insets);
      await page.goto('https://tamo.test/marketplace/index.html');
      await session.send('Emulation.setSafeAreaInsetsOverride', { insets });
      await page.evaluate(() => {
        document.body.classList.remove('pilot-locked');
        document.getElementById('infoDialog').showModal();
      });
      const close = page.locator('#infoDialog button[aria-label="Fechar"]');
      await checkBounds(page, '#infoDialog, #infoDialog button[aria-label="Fechar"]', viewport, insets);
      await close.click();
      assert.equal(await page.locator('#infoDialog').evaluate(dialog => dialog.open), false);
    }
    console.log('Community navigation and Marketplace dialog passed in portrait and both landscape orientations');
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
