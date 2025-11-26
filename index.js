const mineflayer = require("mineflayer");
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

// 存储所有活动的机器人
const activeBots = new Map();

// 中间件
app.use(express.json());

// 全局错误处理 - 必须放在最前面
process.on('uncaughtException', (err) => {
  // 完全静默所有协议错误
  if (err.message && (
    err.message.includes('PartialReadError') ||
    err.message.includes('Unexpected buffer end') ||
    err.message.includes('Chunk size')
  )) {
    return;
  }
  console.error('异常:', err.message);
});

process.on('unhandledRejection', (reason) => {
  if (reason && reason.message && (
    reason.message.includes('PartialReadError') ||
    reason.message.includes('Unexpected buffer end')
  )) {
    return;
  }
  console.error('Promise 错误:', reason);
});

// 创建机器人函数
function createBot(id, host, port, username) {
  try {
    const bot = mineflayer.createBot({
      host: host,
      port: port,
      username: username,
      version: false,
      hideErrors: false, // 改为 false，我们手动处理
      checkTimeoutInterval: 60000,
      keepAlive: true
    });

    bot.customId = id;
    bot.serverInfo = { host, port, username };
    bot.status = "connecting";
    bot.lastError = null;
    bot.spawnLogged = false;

    // 只记录第一次 spawn
    bot.once("spawn", () => {
      if (!bot.spawnLogged) {
        console.log(`[${id}] ${username} 已上线到 ${host}:${port}`);
        bot.spawnLogged = true;
        bot.status = "online";
        bot.lastError = null;
      }
    });

    bot.on("end", (reason) => {
      if (reason !== 'socketClosed') {
        console.log(`[${id}] 连接断开: ${reason}`);
      }
      bot.status = "disconnected";
      bot.spawnLogged = false;
    });

    bot.on("error", (err) => {
      // 忽略所有协议相关错误
      if (err.message && (
        err.message.includes('PartialReadError') ||
        err.message.includes('ECONNRESET') ||
        err.message.includes('Unexpected buffer') ||
        err.message.includes('Chunk size')
      )) {
        return;
      }
      
      // 只记录关键错误
      if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND" || err.code === "ETIMEDOUT") {
        console.error(`[${id}] 连接错误: ${err.message}`);
        bot.status = "error";
        bot.lastError = err.message;
      }
    });

    bot.on("kicked", (reason) => {
      console.log(`[${id}] 被踢出: ${reason}`);
      bot.status = "kicked";
      bot.lastError = reason;
      bot.spawnLogged = false;
    });

    // 拦截底层客户端错误
    if (bot._client) {
      bot._client.on("error", () => {
        // 完全静默
      });
      
      // 移除默认的错误处理器
      bot._client.removeAllListeners('error');
      bot._client.on('error', () => {});
    }

    activeBots.set(id, bot);
    return { success: true, id };
  } catch (error) {
    console.error(`创建机器人失败:`, error.message);
    return { success: false, error: error.message };
  }
}

// API 路由

app.get("/api/bots", (req, res) => {
  const bots = [];
  activeBots.forEach((bot, id) => {
    bots.push({
      id: id,
      host: bot.serverInfo.host,
      port: bot.serverInfo.port,
      username: bot.serverInfo.username,
      status: bot.status,
      error: bot.lastError,
      health: bot.health || 0,
      food: bot.food || 0
    });
  });
  res.json(bots);
});

app.post("/api/bots", (req, res) => {
  const { host, port, username } = req.body;

  if (!host || !port || !username) {
    return res.status(400).json({ error: "缺少必要参数" });
  }

  const id = `bot_${Date.now()}`;
  const result = createBot(id, host, parseInt(port), username);

  if (result.success) {
    res.json({ success: true, id: result.id });
  } else {
    res.status(500).json({ success: false, error: result.error });
  }
});

app.delete("/api/bots/:id", (req, res) => {
  const id = req.params.id;
  const bot = activeBots.get(id);

  if (!bot) {
    return res.status(404).json({ error: "机器人不存在" });
  }

  try {
    bot.end();
  } catch (e) {
    // 忽略关闭错误
  }
  activeBots.delete(id);
  res.json({ success: true });
});

app.post("/api/bots/:id/reconnect", (req, res) => {
  const id = req.params.id;
  const bot = activeBots.get(id);

  if (!bot) {
    return res.status(404).json({ error: "机器人不存在" });
  }

  const { host, port, username } = bot.serverInfo;
  
  try {
    bot.end();
  } catch (e) {
    // 忽略关闭错误
  }
  
  activeBots.delete(id);

  setTimeout(() => {
    const result = createBot(id, host, port, username);
    res.json(result);
  }, 1000);
});

// HTML 内容
const htmlContent = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Minecraft 假玩家管理系统</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        .container { max-width: 1200px; margin: 0 auto; }
        h1 {
            color: white;
            text-align: center;
            margin-bottom: 30px;
            font-size: 2.5em;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        }
        .add-form {
            background: white;
            padding: 25px;
            border-radius: 10px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.3);
            margin-bottom: 30px;
        }
        .form-group { margin-bottom: 15px; }
        label { display: block; margin-bottom: 5px; font-weight: bold; color: #333; }
        input {
            width: 100%;
            padding: 10px;
            border: 2px solid #ddd;
            border-radius: 5px;
            font-size: 14px;
        }
        input:focus { outline: none; border-color: #667eea; }
        button {
            background: #667eea;
            color: white;
            border: none;
            padding: 12px 25px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 16px;
        }
        button:hover { background: #5568d3; }
        .bot-list {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 20px;
        }
        .bot-card {
            background: white;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 5px 15px rgba(0,0,0,0.2);
        }
        .bot-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 2px solid #f0f0f0;
        }
        .bot-username { font-size: 1.2em; font-weight: bold; color: #333; }
        .status {
            padding: 5px 10px;
            border-radius: 20px;
            font-size: 0.85em;
            font-weight: bold;
        }
        .status.online { background: #4caf50; color: white; }
        .status.connecting { background: #ff9800; color: white; }
        .status.error, .status.kicked { background: #f44336; color: white; }
        .status.disconnected { background: #9e9e9e; color: white; }
        .bot-info { margin: 10px 0; color: #666; font-size: 0.9em; }
        .bot-actions { display: flex; gap: 10px; margin-top: 15px; }
        .bot-actions button { flex: 1; padding: 8px; font-size: 14px; }
        .delete-btn { background: #f44336; }
        .delete-btn:hover { background: #d32f2f; }
        .reconnect-btn { background: #4caf50; }
        .reconnect-btn:hover { background: #388e3c; }
        .error-message {
            color: #f44336;
            font-size: 0.85em;
            margin-top: 5px;
            padding: 5px;
            background: #ffebee;
            border-radius: 3px;
        }
        .empty-state {
            text-align: center;
            color: white;
            font-size: 1.2em;
            margin-top: 50px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎮 Minecraft 假玩家管理系统</h1>
        
        <div class="add-form">
            <h2 style="margin-bottom: 20px;">添加新机器人</h2>
            <div class="form-group">
                <label>服务器地址:</label>
                <input type="text" id="host" placeholder="例如: syd.retslav.net">
            </div>
            <div class="form-group">
                <label>端口:</label>
                <input type="number" id="port" placeholder="例如: 10045">
            </div>
            <div class="form-group">
                <label>玩家名称:</label>
                <input type="text" id="username" placeholder="例如: mcplayer">
            </div>
            <button onclick="addBot()">➕ 添加机器人</button>
        </div>
        <div id="botList" class="bot-list"></div>
    </div>
    <script>
        async function loadBots() {
            try {
                const response = await fetch('/api/bots');
                const bots = await response.json();
                const botList = document.getElementById('botList');
                if (bots.length === 0) {
                    botList.innerHTML = '<div class="empty-state">暂无活动机器人，请添加一个</div>';
                    return;
                }
                botList.innerHTML = bots.map(bot => {
                    const healthInfo = bot.status === 'online' ? 
                        '<div>❤️ 生命: ' + bot.health + '/20</div><div>🍖 饥饿: ' + bot.food + '/20</div>' : '';
                    const errorInfo = bot.error ? 
                        '<div class="error-message">错误: ' + bot.error + '</div>' : '';
                    return '<div class="bot-card">' +
                        '<div class="bot-header">' +
                            '<div class="bot-username">' + bot.username + '</div>' +
                            '<div class="status ' + bot.status + '">' + getStatusText(bot.status) + '</div>' +
                        '</div>' +
                        '<div class="bot-info"><div>🌐 ' + bot.host + ':' + bot.port + '</div>' + healthInfo + '</div>' +
                        errorInfo +
                        '<div class="bot-actions">' +
                            '<button class="reconnect-btn" onclick="reconnectBot(\\'' + bot.id + '\\')">🔄 重连</button>' +
                            '<button class="delete-btn" onclick="deleteBot(\\'' + bot.id + '\\')">🗑️ 删除</button>' +
                        '</div></div>';
                }).join('');
            } catch (error) {
                console.error('加载失败:', error);
            }
        }
        function getStatusText(status) {
            const map = {online:'在线',connecting:'连接中',error:'错误',kicked:'被踢出',disconnected:'已断开'};
            return map[status] || status;
        }
        async function addBot() {
            const host = document.getElementById('host').value;
            const port = document.getElementById('port').value;
            const username = document.getElementById('username').value;
            if (!host || !port || !username) { alert('请填写所有字段'); return; }
            try {
                const response = await fetch('/api/bots', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ host, port: parseInt(port), username })
                });
                if (response.ok) {
                    document.getElementById('host').value = '';
                    document.getElementById('port').value = '';
                    document.getElementById('username').value = '';
                    loadBots();
                } else {
                    const error = await response.json();
                    alert('添加失败: ' + error.error);
                }
            } catch (error) {
                alert('添加失败: ' + error.message);
            }
        }
        async function deleteBot(id) {
            if (!confirm('确定要删除这个机器人吗?')) return;
            try {
                await fetch('/api/bots/' + id, { method: 'DELETE' });
                loadBots();
            } catch (error) {
                alert('删除失败: ' + error.message);
            }
        }
        async function reconnectBot(id) {
            try {
                await fetch('/api/bots/' + id + '/reconnect', { method: 'POST' });
                setTimeout(loadBots, 1000);
            } catch (error) {
                alert('重连失败: ' + error.message);
            }
        }
        setInterval(loadBots, 3000);
        loadBots();
    </script>
</body>
</html>`;

app.get("/", (req, res) => {
  res.send(htmlContent);
});

// 启动服务器
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 服务运行在端口 ${PORT}`);
});