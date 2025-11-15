// /api/generate.js (Stable Version)
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url, desc, style } = req.body;
  if (!url || !desc) return res.status(400).json({ error: 'Missing fields' });

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return res.status(500).json({ error: 'Missing OPENROUTER_API_KEY' });

  try {
    // -------------------------------------
    // 1) Generate Image (Multimodal Model)
    // -------------------------------------
    const imagePrompt = `Fotorealistic image for an affiliate product.
Model memegang produk.
Produk: ${desc}
Style: ${style || 'lifestyle, aesthetic, clean lighting'}
Kualitas sangat tinggi, real human model.`;

    const imgRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-exp',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: imagePrompt }
            ]
          }
        ],
        max_tokens: 2048,
        modalities: ['text', 'image']
      })
    });

    const imgJson = await imgRes.json();

    let base64 = null;
    const contentArr = imgJson?.choices?.[0]?.message?.content || [];

    for (const c of contentArr) {
      if (c.type === 'output_image') {
        base64 = c.image_base64;
        break;
      }
    }

    // -------------------------------------
    // 2) Generate Script 4 Scenes
    // -------------------------------------
    const scriptPrompt = `Buat naskah promosi AFFILIATE dalam 4 adegan:
1. Hook
2. Problem
3. Solution
4. CTA
Produk: ${desc}
Gunakan gaya seperti konten TikTok, singkat dan persuasive.`;

    const scriptRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_TEXT_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'user', content: scriptPrompt }
        ]
      })
    });

    const scriptJson = await scriptRes.json();
    const textOut = scriptJson?.choices?.[0]?.message?.content || '';

    // Pecah 4 bagian
    const sections = textOut.split(/
+/).filter(x => x.trim() !== '');
    const scenes = [
      { role: 'Hook', text: sections[0] || '' },
      { role: 'Problem', text: sections[1] || '' },
      { role: 'Solution', text: sections[2] || '' },
      { role: 'CTA', text: sections[3] || '' }
    ];

    return res.json({
      image_base64: base64,
      scenes
    });

  } catch (err) {
    return res.status(500).json({ error: 'Server error', details: String(err) });
  }
}