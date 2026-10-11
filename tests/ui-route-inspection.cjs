// Optional presentation audit invoked by the real native-auth local harness.
// It uses only this invocation's actual Auth cookies/synthetic fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const { inspectInteractions } = require('./ui-interactions.cjs');
const results = [];
const sizes = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'mobile', width: 390, height: 844 },
];
const output = process.env.TRAVELBUDDY_UI_OUTPUT;
if (output) {
  assert.ok(fs.statSync(output).isDirectory(), 'Create the UI evidence directory before running.');
  assert.ok(fs.statSync(path.join(output,'screenshots')).isDirectory(), 'Create its screenshots directory.');
}

async function ready(page) {
  await page.locator('h1').first().waitFor({ timeout: 20000 });
  await page.waitForFunction(() => !document.querySelector('.tb-spinner'), undefined, { timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
}

async function inspect(state) {
  const { base, phase, a,b,c,d,administrator,unassigned,traveler,request,profile,bookingId,verification } = state;
  assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname));
  const routes = phase === 'draft' ? [
    ['family-overview',a,'/dashboard/family'],
    ['family-create',a,'/dashboard/family/create'],
    ['family-edit',a,'/dashboard/family/edit'],
    ['travelers',a,'/dashboard/family/travelers'],
    ['traveler-create',a,'/dashboard/family/travelers/new'],
    ['traveler-profile',a,`/dashboard/family/travelers/${traveler.id}`],
    ['traveler-edit',a,`/dashboard/family/travelers/${traveler.id}/edit`],
    ['requests',a,'/dashboard/family/trip-requests'],
    ['request-create',a,'/dashboard/family/trip-requests/new'],
    ['request-detail',a,`/dashboard/family/trip-requests/${request.id}`],
    ['request-edit',a,`/dashboard/family/trip-requests/${request.id}/edit`],
    ['matching-empty',a,`/dashboard/family/trip-requests/${request.id}/matches`],
    ['catalogue',a,'/dashboard/family/companions'],
    ['companion-overview',c,'/dashboard/companions'],
    ['companion-create',c,'/dashboard/companions/create'],
    ['companion-profile',c,`/dashboard/companions/${profile.id}`],
    ['companion-edit',c,`/dashboard/companions/${profile.id}/edit`],
    ['admin',administrator,'/dashboard/admin'],
    ['role-selection',unassigned,'/select-role'],
    ['travelers-empty',b,'/dashboard/family/travelers'],
    ['requests-empty',b,'/dashboard/family/trip-requests'],
  ] : phase === 'active' ? [
    ['booking-family-active',a,`/dashboard/bookings/${bookingId}`],
    ['booking-companion-active',c,`/dashboard/bookings/${bookingId}`],
    ['matching-populated',a,`/dashboard/family/trip-requests/${request.id}/matches`],
    ['companion-assigned',c,'/dashboard/companions'],
    ['kyc-submitted',c,`/dashboard/companions/${profile.id}`],
    ['admin-review',administrator,'/dashboard/admin'],
  ] : [
    ['booking-family-completed',a,`/dashboard/bookings/${bookingId}`],
    ['booking-companion-completed',c,`/dashboard/bookings/${bookingId}`],
  ];
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    for (const size of sizes) {
      const contexts = new Map();
      async function context(account) {
        if (contexts.has(account.id)) return contexts.get(account.id);
        const ctx = await browser.newContext({ viewport: { width:size.width,height:size.height }, reducedMotion: 'reduce' });
        await ctx.addCookies(account.cookies.getAll().map(cookie => ({ ...cookie,url:base,sameSite:'Lax' })));
        ctx.on('page', page => page.on('pageerror', error => errors.push(error.message)));
        contexts.set(account.id,ctx);
        return ctx;
      }
      for (const [label,account,route] of routes) {
        const ctx = await context(account);
        const page = await ctx.newPage();
        await page.goto(`${base}${route}`);
        await ready(page);
        const metrics = await page.evaluate(() => {
          const visible = e => { const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'; };
          const root = document.querySelector('.tb-app-content') || document.querySelector('.tb-onboarding-card');
          const overflow = [...root.querySelectorAll('*')].filter(e => { if(!visible(e))return false;const r=e.getBoundingClientRect();return r.left < -1 || r.right > innerWidth+1; }).map(e => ({tag:e.tagName,classes:e.className,width:Math.round(e.getBoundingClientRect().width)})).slice(0,8);
          const white = [...root.querySelectorAll('*')].filter(e => visible(e) && ['rgb(255, 255, 255)','rgb(249, 250, 251)'].includes(getComputedStyle(e).backgroundColor)).length;
          const tiny = [...root.querySelectorAll('button,a,input:not([type=checkbox]):not([type=radio]),select,textarea,summary')].filter(e => visible(e)&&e.getBoundingClientRect().height < 43).map(e=>({tag:e.tagName,label:e.textContent.trim().slice(0,45),height:e.getBoundingClientRect().height}));
          const unlabeled = [...root.querySelectorAll('input,select,textarea')].filter(e => visible(e)&&!e.labels?.length&&!e.getAttribute('aria-label')&&!e.getAttribute('aria-labelledby')).length;
          return { documentWidth:document.documentElement.scrollWidth, viewport:innerWidth,overflow,white,tiny,unlabeled, headingColor:getComputedStyle(root.querySelector('h1') || root.querySelector('h2')).color };
        });
        assert.ok(metrics.documentWidth <= size.width, `${label}/${size.name}: document overflow`);
        assert.equal(metrics.overflow.length,0,`${label}/${size.name}: overflowing controls ${JSON.stringify(metrics.overflow)}`);
        assert.equal(metrics.white,0,`${label}/${size.name}: plain white surfaces`);
        assert.equal(metrics.tiny.length,0,`${label}/${size.name}: tiny targets ${JSON.stringify(metrics.tiny)}`);
        assert.equal(metrics.unlabeled,0,`${label}/${size.name}: unlabelled controls`);
        if (size.name !== 'desktop' && route !== '/select-role') {
          await page.getByRole('button',{name:'Open navigation menu'}).click();
          await page.getByRole('dialog').waitFor();
          await page.keyboard.press('Escape');
          assert.equal(await page.getByRole('dialog').isVisible(),false,'Mobile nav did not close on Escape.');
        }
        // Check actual focus visibility, not just the presence of a CSS rule.
        const control = page.locator('.tb-app-content button:not(:disabled),.tb-app-content a,.tb-onboarding-card button:not(:disabled)').first();
        if (await control.count()) {
          await control.focus();
          const outline = await control.evaluate(e => getComputedStyle(e).outlineStyle);
          assert.notEqual(outline,'none',`${label}: keyboard focus has no visible outline`);
          await control.blur();
        }
        await page.evaluate(() => scrollTo(0,0));
        if (output) await page.screenshot({ path:path.join(output,'screenshots',`${label}-${size.name}.png`),fullPage:true });
        results.push({ phase,screen:label,viewport:size.name,width:size.width,passed:true });
        await page.close();
      }
      // Test handlers once; route screenshots at all three widths above are inert.
      if (size.name === 'mobile') await inspectInteractions({ state,browser,context,ready });
      for (const ctx of contexts.values()) await ctx.close();
    }
    assert.equal(errors.length,0,`UI page errors: ${errors.join('; ')}`);
    console.log(`PASS: ${phase} UI audit (${routes.length} screens × 3 viewports); no overflow, tiny targets, white surfaces, unlabelled controls or page errors.`);
    if (output) fs.writeFileSync(path.join(output,'route-checks.json'),JSON.stringify({ browser:'Chromium',sizes,results },null,2));
  } finally { await browser.close(); }
}

module.exports = { inspect };
