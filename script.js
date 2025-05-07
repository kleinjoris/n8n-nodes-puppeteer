async function solveRecaptcha(sitekey, pageUrl, apiKey) {
    const submitUrl = `https://2captcha.com/in.php?key=${apiKey}&method=userrecaptcha&googlekey=${sitekey}&pageurl=${encodeURIComponent(pageUrl)}&json=1`;
  
    console.log(submitUrl);
    const inRes = await $axios.get(submitUrl).then(res => res.data);
    console.log(inRes);
    if (inRes.status !== 1) {
      throw new Error('2Captcha submit error: ' + inRes.request);
    }
  
    const requestId = inRes.request;
    console.log('2Captcha request ID:', requestId);
  
    for (let i = 0; i < 10; i++) {
      console.log(`Polling for token... Attempt ${i + 1}`);
      await new Promise(r => setTimeout(r, 5000));
      const pollUrl = `https://2captcha.com/res.php?key=${apiKey}&action=get&id=${requestId}&json=1`;
      const resJson = await $axios.get(pollUrl).then(res => res.data);
      if (resJson.status === 1) return resJson.request;
    }
  
    throw new Error('2Captcha solve timed out');
}
  
  
async function run() {
    const apiKey = 'd4258e62ccbcf9ab5ca8091df21df386'; // Replace with your real API key
  
    const $browser = await $puppeteer.launch({
      headless: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  
    const $page = await $browser.newPage();
  
    await $page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');
    await $page.setViewport({ width: 1280, height: 800 });
    await $page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  
    try {
      await $page.goto('https://pinalcountyaz-services.app.transform.civicplus.com/forms/31235', {
        waitUntil: 'networkidle2',
        timeout: 60000
      });
  
      const title = await $page.title();
      if (title.includes("ERROR")) throw new Error("Blocked by CloudFront or CDN");
  
      await $page.waitForSelector('#Case_Number', { timeout: 15000 });
      await $page.type('#Case_Number', 'CR-20141313');
      await $page.type('#Year', '2014');
      await $page.type('#Title_of_Documents', 'Sentencing Order');
  
      const iframe = await $page.waitForSelector('iframe[src*="recaptcha/api2/anchor"]', { timeout: 10000 });
      const src = await (await iframe.getProperty('src')).jsonValue();
      const m = src.match(/[?&]k=([^&]+)/);
      if (!m) throw new Error('Could not extract reCAPTCHA sitekey');
      const sitekey = m[1];
  
      const token = await solveRecaptcha(sitekey, $page.url(), apiKey);
  
      await $page.evaluate((tok) => {
        let ta = document.getElementById('g-recaptcha-response');
        if (!ta) {
          ta = document.createElement('textarea');
          ta.id = 'g-recaptcha-response';
          ta.name = 'g-recaptcha-response';
          ta.style.display = 'none';
          document.body.appendChild(ta);
        }
        ta.value = tok;
  
        ['input', 'change'].forEach(evt => {
          ta.dispatchEvent(new Event(evt, { bubbles: true }));
        });
      }, token);
  
      await new Promise(r => setTimeout(r, 1000));
  
      const screenshotBase64 = await $page.screenshot({
        fullPage: true,
        type: 'png',
        encoding: 'base64',
      });
  
      return [
        {
          json: { success: true, note: 'Filled but not submitted' },
          binary: {
            preSubmitScreenshot: {
              data: screenshotBase64,
              mimeType: 'image/png',
              fileName: 'pre-submit.png',
            },
          },
        },
      ];
    } catch (err) {
      return [
        {
          json: { success: false, error: err.message },
        },
      ];
    } finally {
      await $browser.close();
    }
}
  
return await run();
  