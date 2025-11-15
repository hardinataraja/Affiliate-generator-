// api/generate.js
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { url, styleHint } = req.body || {};
  if (!url) return res.status(400).json({ error: 'Missing url' });

  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  const MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash-image-preview:latest';
  if (!OPENROUTER_API_KEY) return res.status(500).json({ error: 'Server not configured: missing OPENROUTER_API_KEY' });

  try {
    // 1) Try to fetch product page and extract og:image/title/description
    const pageResp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AffiliateGenerator/1.0)' } });
    const html = await pageResp.text();
    const ogImageMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
    const titleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) || html.match(/<title>([^<]+)<\/title>/i);
    const descMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i) || html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i);

    const title = titleMatch ? titleMatch[1] : '';
    const description = descMatch ? descMatch[1] : '';
    const ogImage = ogImageMatch ? ogImageMatch[1] : null;

    let image_url = null;
    let image_base64 = null;

    // 2) If og:image present, try to use it. Otherwise ask OpenRouter to generate an image.
    if (ogImage) {
      image_url = ogImage;
    } else {
      // Build a compact prompt for image generation
      const prompt = `High quality photorealistic product shot of the following product: ${title || description || url}. Include a real-looking model holding the product in a natural lifestyle pose. Style: ${styleHint || 'clean studio / lifestyle, vibrant colors, 16:9'}. Straight-forward composition, high detail.`;

      // Send request to OpenRouter chat/completions with modalities for image generation.
      const payload = {
        model: MODEL,
        messages: [
          { role: 'system', content: 'You are an image generation assistant. Return image(s) as base64 in the response if supported.' },
          { role: 'user', content: prompt }
        ],
        modalities: ['text','image']
      };

      const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const orJson = await orRes.json();
      // The exact shape can vary by model/provider. Try to extract image output:
      // - If provider returns image URL(s) in `output` or `choices` -> we adapt.
      try {
        // Some OpenRouter responses embed generated images in choices[0].message.content or `output` array
        const choice = orJson?.choices?.[0];
        // try several common locations
        const possible = choice?.message?.content || choice?.message?.output || orJson?.output || orJson?.data;
        // If there is a base64 payload inside the object, attempt to find it
        const b64 = JSON.stringify(possible).match(/([A-Za-z0-9+/=]{200,})/);
        if (b64) {
          image_base64 = b64[1];
        }
        // If provider returned a public URL inside content plain text, try to extract it
        const urlMatch = JSON.stringify(possible).match(/https?:\\/\\/[^\"\'\s,]+/);
        if (urlMatch && !image_base64) image_url = urlMatch[0];
      } catch (e) {
        console.warn('Could not parse image output', e);
      }
    }

    // 3) Generate the 4-scene script using a Chat completion (OpenRouter chat)
    const scriptPrompt = `Buat naskah singkat promosi AFFILIATE untuk produk berikut. Berikan 4 adegan berurutan: Hook, Problem, Solution, CTA. Untuk tiap adegan beri judul singkat dan 1–3 baris naskah yang conversational, persuasif, dan cocok untuk voiceover serta caption. Sertakan call-to-action yang jelas (link akan disisipkan oleh user). Produk: ${title || description || url}`;

    const chatPayload = {
      model: process.env.OPENROUTER_TEXT_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a helpful copywriter for short marketing videos.' },
        { role: 'user', content: scriptPrompt }
      ]
    };

    const chatRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(chatPayload)
    });

    const chatJson = await chatRes.json();
    // Attempt to parse scenes — best-effort: if model returns numbered sections, split.
    let scenes = [];
    const textOut = chatJson?.choices?.[0]?.message?.content || chatJson?.choices?.[0]?.text || '';
    if (textOut) {
      // naive split by headings
      const parts = textOut.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
      // Try to map into 4 scenes
      for (let p of parts) {
        const m = p.match(/^(Hook|Problem|Solution|CTA|1\.|2\.|3\.|4\.)[:\-\s]*(.*)/i);
        if (m) {
          const role = (m[1] || '').replace(/\d\.|[:\-]/g,'').trim();
          const txt = m[2] ? m[2].trim() : p;
          scenes.push({ role: role || 'Scene', text: txt });
        } else {
          // fallback: push as generic
          scenes.push({ role: 'Scene', text: p });
        }
      }
    }

    // Ensure exactly 4 scenes (best-effort): if not, split/trim.
    if (scenes.length < 4 && textOut) {
      // split the text into 4 roughly equal chunks
      const lines = textOut.split('\n').filter(Boolean);
      const chunkSize = Math.ceil(lines.length / 4) || 1;
      scenes = [];
      for (let i=0;i<4;i++) scenes.push({ role: ['Hook','Problem','Solution','CTA'][i], text: lines.slice(i*chunkSize,(i+1)*chunkSize).join(' ') });
    }

    // 4) Return assembled data
    return res.json({
      title: title || '',
      description: description || '',
      image_url,
      image_base64,
      script: textOut || '',
      scenes
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal error', details: String(err) });
  }
        }
