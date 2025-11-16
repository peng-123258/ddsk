const express = require("express");
const app = express();
const axios = require("axios");
const os = require('os');
const fs = require("fs");
const path = require("path");
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);
const { execSync } = require('child_process');

// 配置参数（SOCKS变量名修改为DDCK）
const UPLOAD_URL = process.env.UPLOAD_URL || '';      // 节点或订阅自动上传地址
const PROJECT_URL = process.env.PROJECT_URL || '';    // 项目分配的url
const AUTO_ACCESS = process.env.AUTO_ACCESS || false; // 自动保活开关
const FILE_PATH = process.env.FILE_PATH || './tmp';   // 运行目录
const SUB_PATH = process.env.SUB_PATH || 'ccc';       // 订阅路径
const PORT = process.env.SERVER_PORT || process.env.PORT || 3000; // http服务端口
const DDCK_PORT = process.env.DDCK_PORT || 25658;      // DDCK服务端口
const DDCK_USER = process.env.DDCK_USER || 'ddckuser'; // DDCK认证用户名
const DDCK_PASS = process.env.DDCK_PASS || 'ddckpass'; // DDCK认证密码
const NAME = process.env.NAME || 'DDCK';              // 节点名称

//N 创建运行文件夹（修复注释语法）
if (!fs.existsSync(FILE_PATH)) {
  fs.mkdirSync(FILE_PATH, { recursive: true }); // 增加recursive确保多级目录可创建
  console.log(`${FILE_PATH} is created`);
} else {
  console.log(`${FILE_PATH} already exists`);
}

// 定义文件路径
let webPath = path.join(FILE_PATH, 'web');
let subPath = path.join(FILE_PATH, 'sub.txt');
let listPath = path.join(FILE_PATH, 'list.txt');
let configPath = path.join(FILE_PATH, 'config.json');

// 清理历史文件
function cleanupOldFiles() {
  const pathsToDelete = ['web', 'sub.txt'];
  pathsToDelete.forEach(file => {
    const filePath = path.join(FILE_PATH, file);
    if (fs.existsSync(filePath)) { // 先判断文件是否存在再删除
      fs.unlink(filePath, (err) => {
        if (err) console.error(`删除${filePath}失败: ${err.message}`);
      });
    }
  });
}

// 根路由
app.get("/", function(req, res) {
  res.send("Hello world!");
});

// 生成DDCK核心配置文件
const config = {
  log: { access: '/dev/null', error: '/dev/null', loglevel: 'none' },
  inbounds: [
    { 
      port: DDCK_PORT, 
      listen: "0.0.0.0",  // 监听所有网络接口
      protocol: "socks",
      settings: { 
        auth: "password",
        accounts: [
          { user: DDCK_USER, pass: DDCK_PASS }
        ],
        udp: true,
        ip: "127.0.0.1"
      },
      streamSettings: { 
        network: "tcp",
        security: "none"
      },
      sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false }
    }
  ],
  dns: { servers: ["https+local://8.8.8.8/dns-query"] },
  outbounds: [ { protocol: "freedom", tag: "direct" }, { protocol: "blackhole", tag: "block" } ]
};
// 写入配置文件时增加错误处理
try {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log("配置文件生成成功");
} catch (err) {
  console.error(`配置文件写入失败: ${err.message}`);
}

// 判断系统架构
function getSystemArchitecture() {
  const arch = os.arch();
  if (arch === 'arm' || arch === 'arm64' || arch === 'aarch64') {
    return 'arm';
  } else {
    return 'amd';
  }
}

// 下载对应系统架构的核心依赖
function downloadFile(fileName, fileUrl, callback) {
  const filePath = path.join(FILE_PATH, fileName);
  // 若文件已存在，先删除旧文件
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  const writer = fs.createWriteStream(filePath);

  axios({
    method: 'get',
    url: fileUrl,
    responseType: 'stream',
    timeout: 30000 // 增加超时时间（30秒）
  })
    .then(response => {
      response.data.pipe(writer);

      writer.on('finish', () => {
        writer.close();
        console.log(`Download ${fileName} successfully`);
        callback(null, fileName);
      });

      writer.on('error', err => {
        fs.unlink(filePath, () => {});
        const errorMessage = `Download ${fileName} failed: ${err.message}`;
        console.error(errorMessage);
        callback(errorMessage);
      });
    })
    .catch(err => {
      const errorMessage = `Download ${fileName} failed: ${err.message}`;
      console.error(errorMessage);
      callback(errorMessage);
    });
}

// 下载并运行核心服务
async function downloadFilesAndRun() {
  try {
    const architecture = getSystemArchitecture();
    const filesToDownload = getFilesForArchitecture(architecture);

    if (filesToDownload.length === 0) {
      throw new Error(`不支持的系统架构: ${architecture}`);
    }

    const downloadPromises = filesToDownload.map(fileInfo => {
      return new Promise((resolve, reject) => {
        downloadFile(fileInfo.fileName, fileInfo.fileUrl, (err, fileName) => {
          if (err) {
            reject(err);
          } else {
            resolve(fileName);
          }
        });
      });
    });

    await Promise.all(downloadPromises);

    // 授权文件
    function authorizeFiles(filePaths) {
      const newPermissions = 0o775;
      filePaths.forEach(relativeFilePath => {
        const absoluteFilePath = path.join(FILE_PATH, relativeFilePath);
        if (fs.existsSync(absoluteFilePath)) {
          fs.chmod(absoluteFilePath, newPermissions, (err) => {
            if (err) {
              console.error(`权限设置失败 ${absoluteFilePath}: ${err}`);
            } else {
              console.log(`权限设置成功 ${absoluteFilePath}`);
            }
          });
        } else {
          console.error(`文件不存在，无法设置权限: ${absoluteFilePath}`);
        }
      });
    }
    authorizeFiles(['./web']);

    // 运行核心服务（增加进程存在性检查）
    const command = `nohup ${FILE_PATH}/web -c ${configPath} >/dev/null 2>&1 &`;
    await exec(command);
    console.log('DDCK service is running');
    await new Promise(resolve => setTimeout(resolve, 1000));
  } catch (error) {
    console.error(`服务启动失败: ${error.message}`);
    throw error; // 抛出错误，让上层捕获
  }
}

// 根据架构返回核心文件URL（请替换为实际可用地址）
function getFilesForArchitecture(architecture) {
  if (architecture === 'arm') {
    return [
      { fileName: "web", fileUrl: "https://arm64.ssss.nyc.mn/web" }
    ];
  } else {
    return [
      { fileName: "web", fileUrl: "https://amd64.ssss.nyc.mn/web" }
    ];
  }
}

// 生成DDCK节点链接和订阅
async function generateLinks() {
  try {
    // 获取ISP信息（增加错误处理）
    let metaInfo;
    try {
      metaInfo = execSync(
        'curl -s https://speed.cloudflare.com/meta | awk -F\\" \'{print $26"-"$18}\' | sed -e \'s/ /_/g\'',
        { encoding: 'utf-8', timeout: 5000 }
      );
    } catch (err) {
      console.warn(`获取ISP信息失败，使用默认值: ${err.message}`);
      metaInfo = 'unknown-ISP';
    }
    const ISP = metaInfo.trim() || 'unknown-ISP';

    // 获取服务器IP（增加错误处理和多源备份）
    let serverIP;
    try {
      serverIP = execSync('curl -s http://icanhazip.com || curl -s http://ifconfig.me', { 
        encoding: 'utf-8', 
        timeout: 5000 
      }).trim();
    } catch (err) {
      console.warn(`获取公网IP失败，使用默认值: ${err.message}`);
      serverIP = '127.0.0.1'; // 本地测试用，实际部署需确保能获取公网IP
    }

    return new Promise((resolve) => {
      setTimeout(() => {
        // 生成节点链接
        const ddckLink = `socks5://${DDCK_USER}:${DDCK_PASS}@${serverIP}:${DDCK_PORT}#${NAME}-${ISP}`;

        // 保存订阅文件
        try {
          fs.writeFileSync(subPath, Buffer.from(ddckLink).toString('base64'));
          console.log(`${FILE_PATH}/sub.txt saved successfully`);
          uplodNodes(ddckLink);
        } catch (err) {
          console.error(`订阅文件保存失败: ${err.message}`);
        }

        // 订阅路由
        app.get(`/${SUB_PATH}`, (req, res) => {
          try {
            const encodedContent = Buffer.from(ddckLink).toString('base64');
            res.set('Content-Type', 'text/plain; charset=utf-8');
            res.send(encodedContent);
          } catch (err) {
            res.status(500).send(`订阅生成失败: ${err.message}`);
          }
        });
        resolve(ddckLink);
      }, 2000);
    });
  } catch (err) {
    console.error(`生成链接失败: ${err.message}`);
    throw err;
  }
}

// 自动上传DDCK节点
async function uplodNodes(ddckLink) {
  if (!UPLOAD_URL) return; // 无上传地址则直接返回

  try {
    if (UPLOAD_URL && PROJECT_URL) {
      const subscriptionUrl = `${PROJECT_URL}/${SUB_PATH}`;
      const jsonData = { subscription: [subscriptionUrl] };
      await axios.post(`${UPLOAD_URL}/api/add-subscriptions`, jsonData, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      });
      console.log('DDCK subscription uploaded successfully');
    } else if (UPLOAD_URL) {
      const nodes = [ddckLink];
      await axios.post(`${UPLOAD_URL}/api/add-nodes`, 
        JSON.stringify({ nodes }),
        { 
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000
        }
      );
      console.log('DDCK nodes uploaded successfully');
    }
  } catch (error) {
    console.error(`上传失败: ${error.message}`);
    // 非400错误才提示（400可能是重复上传）
    if (!error.response || error.response.status !== 400) {
      console.error(`详细错误: ${JSON.stringify(error.response?.data || {})}`);
    }
  }
}

// 自动访问保活
async function AddVisitTask() {
  if (!AUTO_ACCESS || !PROJECT_URL) {
    console.log("Skipping automatic access task");
    return;
  }
  try {
    await axios.post('https://oooo.serv00.net/add-url', { url: PROJECT_URL }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    });
    console.log("Automatic access task added");
  } catch (error) {
    console.error(`保活任务添加失败: ${error.message}`);
  }
}

// 90s后清理临时文件（优化删除逻辑）
function cleanFiles() {
  setTimeout(() => {
    const filesToDelete = [configPath, webPath];
    filesToDelete.forEach(path => {
      if (fs.existsSync(path)) {
        try {
          fs.rmSync(path, { recursive: true, force: true }); // 使用fs.rmSync更安全
          console.log(`已删除: ${path}`);
        } catch (err) {
          console.error(`删除${path}失败: ${err.message}`);
        }
      }
    });
    console.clear();
    console.log('DDCK app is running');
    console.log('Thank you for using this script, enjoy!');
  }, 90000);
}

// 启动流程（增加全局错误捕获）
async function startserver() {
  try {
    cleanupOldFiles();
    await downloadFilesAndRun();
    await generateLinks();
    AddVisitTask();
    cleanFiles(); // 启动清理任务
  } catch (err) {
    console.error('启动过程出错，服务可能无法正常运行:', err.message);
  }
}

// 启动服务
startserver();

// 启动HTTP服务（增加错误处理）
app.listen(PORT, (err) => {
  if (err) {
    console.error(`HTTP服务启动失败: ${err.message}`);
  } else {
    console.log(`HTTP server running on port: ${PORT}`);
  }
});
