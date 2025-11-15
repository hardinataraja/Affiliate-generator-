export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Hanya menerima POST." });
    }

    const { url, desc, style } = req.body || {};

    if (!process.env.OPENROUTER_API_KEY) {
      return res.status(500).json({
        error: "API Key tidak ditemukan",
        error_detail: "Set OPENROUTER_API_KEY di Vercel → Settings → Environment Variables"
      });
    }

    if (!url || !desc) {
      return res.status(400).json({
        error: "Input tidak lengkap",
        error_detail: "Field 'url' dan 'desc' wajib dikirim oleh frontend."
      });
    }

    // MODEL DEFAULT STABIL
    const IMAGE_MODEL = process.env.IMAGE_MODEL || "google/gemini-2.0-flash-exp";
    const TEXT_MODEL  = process.env.TEXT_MODEL  || "google/gemini-2.0-flash-lite-preview";
    const KEY = process.env.OPENROUTER_API_KEY;

    // --------------------------------------------------------------
    // 1) GENERATE IMAGE
    // --------------------------------------------------------------

    const imgPrompt = `
Buatkan foto produk untuk kebutuhan konten affiliate.
Gunakan gaya realistik, aesthetic, clean lighting.

Produk:
${desc}

Style tambahan:
${style || "lifestyle, clean soft lighting"}

Foto harus terlihat profesional, orientasi potrait, 1 model memegang produk atau menunjukkan produk.
    `;

    const imgResp = await fetch("https://openrouter.ai/api/v1/images", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${KEY}`,
        "HTTP-Referer": "https://yourapp.com",
        "X-Title": "Affiliate Generator",
      },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        prompt: imgPrompt,
        size: "1024x1024"
      })
    });

    const imgJson = await imgResp.json().catch(e => {
      return { error: "Gagal parse JSON image", error_detail: String(e) };
    });

    if (imgJson.error) {
      return res.status(500).json({
        error: "Gagal generate gambar",
        error_detail: imgJson.error_detail || imgJson.error
      });
    }

    const image_base64 = imgJson.image || imgJson.data?.[0]?.b64_json;
    if (!image_base64) {
      return res.status(500).json({
        error: "Gagal membaca output gambar",
        error_detail: JSON.stringify(imgJson)
      });
    }

    // --------------------------------------------------------------
    // 2) GENERATE SCRIPT 4 ADEGAN
    // --------------------------------------------------------------

    const scriptPrompt = `
Buatkan naskah konten short video affiliate.
Format harus seperti:

[
  { "role": "Hook",    "text": "..."},
  { "role": "Problem", "text": "..."},
  { "role": "Solution","text": "..."},
  { "role": "CTA",     "text": "..."}
]

Produk: ${desc}
URL Referensi: ${url}

Ringkas, langsung to-the-point, gaya bahasa ringan dan friendly.
    `;

    const scriptResp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${KEY}`,
        "HTTP-Referer": "https://yourapp.com",
        "X-Title": "Affiliate Generator",
      },
      body: JSON.stringify({
        model: TEXT_MODEL,
        messages: [
          { role: "system", content: "You are an expert script writer." },
          { role: "user", content: scriptPrompt }
        ]
      })
    });

    const scriptJson = await scriptResp.json().catch(e => ({
      error: "Gagal parse JSON script",
      error_detail: String(e)
    }));

    if (scriptJson.error) {
      return res.status(500).json({
        error: "Gagal generate naskah",
        error_detail: scriptJson.error_detail || scriptJson.error
      });
    }

    let textRaw = scriptJson.choices?.[0]?.message?.content?.trim();
    if (!textRaw) {
      return res.status(500).json({
        error: "Tidak ada output naskah",
        error_detail: JSON.stringify(scriptJson)
      });
    }

    // Pastikan output JSON valid
    let scenes = [];
    try {
      scenes = JSON.parse(textRaw);
    } catch (e) {
      // Jika output bukan JSON, ubah manual menjadi 4 bagian
      scenes = [
        { role: "Hook", text: textRaw }
      ];
    }

    return res.status(200).json({
      image_base64,
      scenes
    });

  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      error_detail: String(err)
    });
  }
}