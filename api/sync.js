/* Vercel Serverless Function — 数据同步代理
   用 GitHub 仓库中的 data.json 做云存储，本函数做安全代理 */

const OWNER = "llT519";
const REPO = "workspace";
const DATA_PATH = "data.json";
const BRANCH = "main";

export default async function handler(req, res) {
  // CORS 头
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const TOKEN = process.env.GITHUB_TOKEN;
  if (!TOKEN) {
    return res.status(500).json({ error: "GITHUB_TOKEN 未配置" });
  }

  const apiBase = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${DATA_PATH}`;
  const headers = {
    Authorization: `Bearer ${TOKEN}`,
    "User-Agent": "workspace-sync",
    Accept: "application/vnd.github+json",
  };

  try {
    if (req.method === "GET") {
      // 读取 data.json
      const resp = await fetch(apiBase + "?ref=" + BRANCH, { headers });
      if (resp.status === 404) {
        return res.json({ exists: false, data: {} });
      }
      if (!resp.ok) {
        const err = await resp.text();
        return res.status(resp.status).json({ error: err.substring(0, 200) });
      }
      const json = await resp.json();
      const content = Buffer.from(json.content, "base64").toString("utf-8");
      let data;
      try {
        data = JSON.parse(content);
      } catch (e) {
        data = {};
      }
      return res.json({ exists: true, sha: json.sha, data });
    }

    if (req.method === "POST") {
      // 写入 data.json（智能合并）
      const newData = req.body;
      if (!newData || typeof newData !== "object") {
        return res.status(400).json({ error: "数据格式错误" });
      }

      // 先获取当前文件 SHA（如果存在）
      let sha = null;
      let existingData = {};
      try {
        const getResp = await fetch(apiBase + "?ref=" + BRANCH, { headers });
        if (getResp.ok) {
          const json = await getResp.json();
          sha = json.sha;
          try {
            existingData = JSON.parse(Buffer.from(json.content, "base64").toString("utf-8"));
          } catch (e) {}
        }
      } catch (e) {}

      // 智能合并：新数据覆盖旧数据的对应 key
      const merged = { ...existingData, ...newData };
      const content = Buffer.from(JSON.stringify(merged, null, 2)).toString("base64");

      const putBody = {
        message: "sync: 更新数据",
        content,
        branch: BRANCH,
      };
      if (sha) putBody.sha = sha;

      const putResp = await fetch(apiBase, {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(putBody),
      });

      if (!putResp.ok) {
        const err = await putResp.text();
        return res.status(putResp.status).json({ error: err.substring(0, 200) });
      }

      return res.json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
