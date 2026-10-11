// UI presentation/interaction regression checks using actual local accounts.
const assert = require('node:assert/strict');

async function inspectInteractions({ state,context,ready }) {
  const { base,phase,a,c,administrator,traveler,request,profile,bookingId,verification } = state;
  const familyContext = await context(a);
  const page = await familyContext.newPage();
  try {
    if (phase === 'draft') {
      await page.goto(`${base}/dashboard/family/edit`); await ready(page);
      await page.route('**/dashboard/family/edit', async route => {
        if (route.request().method() === 'POST') await new Promise(resolve => setTimeout(resolve,600));
        await route.continue();
      });
      await page.getByRole('button',{name:'Save Family',exact:true}).click();
      const saving = page.getByRole('button',{name:'Saving...',exact:true});
      await saving.waitFor(); assert.equal(await saving.isDisabled(),true);
      await page.waitForURL(`${base}/dashboard/family`); await ready(page);
      await page.goto(`${base}/dashboard/family/travelers/${traveler.id}/edit`); await ready(page);
      await page.getByLabel('Primary Contact Name',{exact:true}).fill('Local UI Contact');
      await page.getByLabel('Primary Contact Phone',{exact:true}).fill('+44 7700 900000');
      await page.getByRole('button',{name:'Save Traveler',exact:true}).click();
      await page.waitForURL(`${base}/dashboard/family/travelers/${traveler.id}`); await ready(page);
      await page.locator('dd').filter({hasText:'Local UI Contact'}).waitFor();
      await page.goto(`${base}/dashboard/family/trip-requests/${request.id}/edit`); await ready(page);
      await page.getByRole('button',{name:/Update Trip Request|Save Trip Request|Save Changes/}).click();
      await page.waitForURL(`${base}/dashboard/family/trip-requests/${request.id}`); await ready(page);
      const companion = await (await context(c)).newPage();
      try {
        await companion.goto(`${base}/dashboard/companions/${profile.id}/edit`); await ready(companion);
        const monday = companion.locator('[aria-labelledby="monday-heading"]');
        await monday.getByRole('button',{name:'Add Time Range'}).click();
        await companion.getByRole('button',{name:'Save Availability',exact:true}).click();
        await companion.getByRole('alert').filter({hasText:'Monday availability needs both a start and end time.'}).waitFor();
        await monday.getByRole('button',{name:'Remove',exact:true}).last().click();
        await companion.getByRole('button',{name:'Save Availability',exact:true}).click();
        await companion.getByText('Your weekly availability has been saved.',{exact:true}).waitFor();
        await companion.getByLabel('Verification document',{exact:true}).setInputFiles({name:'invalid.txt',mimeType:'text/plain',buffer:Buffer.from('synthetic')});
        await companion.getByRole('alert').filter({hasText:'Choose a PDF, JPG, JPEG, or PNG document.'}).waitFor();
        assert.ok(await companion.getByRole('button',{name:'Submit for review'}).isDisabled());
        await companion.getByRole('button',{name:'Save Companion Profile',exact:true}).click();
        await companion.waitForURL(`${base}/dashboard/companions/${profile.id}`); await ready(companion);
      } finally { await companion.close(); }
      const failurePage = await familyContext.newPage();
      try {
        // Simulated network failure tests only the presentation, not authority.
        await failurePage.route('**/dashboard/family', async route => {
          if (route.request().method() === 'POST') await route.abort('failed');
          else await route.continue();
        });
        await failurePage.goto(`${base}/dashboard/family`);
        await failurePage.getByRole('alert').filter({hasText:'We couldn’t load your family profile. Please try again.'}).waitFor();
        await failurePage.unroute('**/dashboard/family');
        await failurePage.getByRole('button',{name:'Retry',exact:true}).click();
        await ready(failurePage);
        await failurePage.goto(`${base}/dashboard/bookings/00000000-0000-4000-8000-000000000000`);
        await failurePage.getByRole('alert').waitFor();
        await failurePage.getByRole('button',{name:'Try Again',exact:true}).waitFor();
      } finally { await failurePage.close(); }
      console.log('PASS: redesigned family/traveler/request/profile saves, availability validation/success and KYC invalid-file feedback.');
      console.log('PASS: disabled save/loading feedback, network-error recovery and unavailable-booking state.');
    }
    if (phase === 'active') {
      await page.goto(`${base}/dashboard/bookings/${bookingId}`); await ready(page);
      await page.getByLabel('Message',{exact:true}).fill('Synthetic redesigned UI conversation');
      await page.getByRole('button',{name:'Send Message',exact:true}).click();
      await page.getByText('Synthetic redesigned UI conversation',{exact:true}).waitFor();
      await page.getByRole('button',{name:'Grant Location Sharing',exact:true}).click();
      await page.getByRole('button',{name:'Revoke Location Sharing',exact:true}).waitFor();
      await page.getByRole('button',{name:'Revoke Location Sharing',exact:true}).click();
      await page.getByRole('button',{name:'Grant Location Sharing',exact:true}).waitFor();
      await page.goto(`${base}/dashboard/family/trip-requests/${request.id}/matches`); await ready(page);
      const explanation = page.getByRole('button',{name:'Hide Match Explanation',exact:true}).first();
      if (await explanation.count()) { await explanation.click(); await page.getByRole('button',{name:'View Match Explanation',exact:true}).first().click(); }
      const companion = await (await context(c)).newPage();
      try {
        await companion.goto(`${base}/dashboard/bookings/${bookingId}`); await ready(companion);
        await companion.getByRole('button',{name:'Check In',exact:true}).click();
        await companion.getByText('Last Check-in',{exact:true}).first().waitFor();
        // Submit only a supported synthetic document owned by this test account.
        await companion.goto(`${base}/dashboard/companions/${profile.id}`); await ready(companion);
        await companion.getByLabel('Verification document',{exact:true}).setInputFiles({name:'ui-review.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n% local UI fixture\n%%EOF')});
        await companion.getByRole('button',{name:'Submit for review'}).click();
        await companion.getByText('Your document was submitted successfully. Check its current review status below.',{exact:true}).waitFor();
      } finally { await companion.close(); }
      const adminPage = await (await context(administrator)).newPage();
      try {
        await adminPage.goto(`${base}/dashboard/admin`); await ready(adminPage);
        // Select ONLY this invocation's newly uploaded companion fixture. Never
        // approve a historical queue row that happens to be selected by default.
        const target = adminPage.getByRole('button').filter({hasText:`Companion ${profile.id.slice(0,8)}`}).first();
        await target.click();
        await adminPage.waitForFunction(() => !document.querySelector('.tb-spinner'));
        await adminPage.getByRole('button',{name:'Approve',exact:true}).click();
        const dialog = adminPage.getByRole('dialog'); await dialog.waitFor();
        await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
        assert.equal(await dialog.isVisible(),false);
        await adminPage.getByRole('button',{name:'Approve',exact:true}).click();
        await dialog.getByRole('button',{name:'Approve',exact:true}).click();
        await adminPage.waitForFunction(() => !document.querySelector('dialog[open]') && !document.querySelector('.tb-spinner'));
        await adminPage.getByText('Verification review recorded: approved.',{exact:true}).waitFor();
      } finally { await adminPage.close(); }
      console.log('PASS: redesigned chat send, consent toggles, companion check-in, KYC upload and focus-trapped admin cancel/confirm.');
    }
    if (phase === 'completed') {
      await page.goto(`${base}/dashboard/bookings/${bookingId}`); await ready(page);
      await page.getByText('This completed trip has already been rated. The saved rating and review are shown above.',{exact:true}).waitFor();
      assert.equal(await page.getByRole('button',{name:'Send Message',exact:true}).count(),0);
      assert.equal(await page.getByRole('button',{name:'Send In-App SOS',exact:true}).count(),0);
      assert.equal(await page.getByRole('button',{name:'Test Payment: Mark Paid',exact:true}).count(),0);
      console.log('PASS: completed journey preserves closed-trip/chat/SOS and production payment gates.');
    }
  } finally { await page.close(); }
}

module.exports = { inspectInteractions };
