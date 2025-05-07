# n8n-nodes-puppeteer

### n8n-nodes-puppeteer with axios

```javascript
  const inRes = await axios.get(submitUrl).then(res => res.data);
  console.log(inRes);
  if (inRes.status !== 1) {
    throw new Error('2Captcha submit error: ' + inRes.request);
  }
```
