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
const DDCK_PORT = process.env.DDCK_PORT || 25658;      // DDCK服务端口（原SOCKS_PORT）
const DDCK_USER = process.env.DDCK_USER || 'proxyuser'; // DDCK认证用户名（原SOCKS_USER）
const DDCK_PASS = process.env.DDCK_PASS || 'proxypass'; // DDCK认证密码（原SOCKS_PASS）
const NAME = process.env.NAME || 'DDCK';              // 节点名称（默认改为DDCK）

.N 创建运行文件夹
if (!fs.existsSync(FILE_PATH)) {
  fs.mkdirSync(FILE_PATH);
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
    fs.unlink(filePath, () => {});
  });
}

// 根路由
app.get("/", function(req, res) {
  res.send("Hello world!");
});

// 生成DDCK核心配置文件（使用新变量名）
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
          { user: DDCK_USER, pass: DDCK_PASS }  // 使用DDCK_USER和DDCK_PASS
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
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

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
  const writer = fs.createWriteStream(filePath);

  axios({
    method: 'get',
    url: fileUrl,
    responseType: 'stream',
  })
    .then(response => {
      response.data.pipe(writer);

      writer.on('finish', () => {
        writer.close();
        console.log(`Download ${fileName} successfully`);
        callback(null, fileName);
      });

      writer.on('error', err => {
        fs.unlink(filePath, () => { });
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

// 下载并运行核心服务（使用DDCK变量）
async function downloadFilesAndRun() {
  const architecture = getSystemArchitecture();
  const filesToDownload = getFilesForArchitecture(architecture);

  if (filesToDownload.length === 0) {
    console.log(`Can't find files for current architecture`);
    return;
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

  try {
    await Promise.all(downloadPromises);
  } catch (err) {
    console.error('Error downloading files:', err);
    return;
  }

  // 授权文件
  function authorizeFiles(filePaths) {
    const newPermissions = 0o775;
    filePaths.forEach(relativeFilePath => {
      const absoluteFilePath = path.join(FILE_PATH, relativeFilePath);
      if (fs.existsSync(absoluteFilePath)) {
        fs.chmod(absoluteFilePath, newPermissions, (err) => {
          if (err) {
            console.error(`Permission failed for ${absoluteFilePath}: ${err}`);
          } else {
            console.log(`Permission success for ${absoluteFilePath}`);
          }
        });
      }
    });
  }
  authorizeFiles(['./web']);

  // 运行核心服务（DDCK）
  const command = `nohup ${FILE_PATH}/web -c ${configPath} >/dev/null 2>&1 &`;
  try {
    await exec(command);
    console.log('DDCK service is running');
    await new Promise(resolve => setTimeout(resolve, 1000));
  } catch (error) {
    console.error(`Service start error: ${error}`);
  }
}

// 根据架构返回核心文件URL
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

// 生成DDCK节点链接和订阅（使用新变量名）
async function generateLinks() {
  const metaInfo = execSync(
    'curl -s https://speed.cloudflare.com/meta | awk -F\\" \'{print $26"-"$18}\' | sed -e \'s/ /_/g\'',
    { encoding: 'utf-8' }
  );
  const ISP = metaInfo.trim();

  // 获取服务器IP（用于节点链接）
  const serverIP = execSync('curl -s http://icanhazip.com || curl -s http://ifconfig.me', { encoding: 'utf-8' }).trim();

  return new Promise((resolve) => {
    setTimeout(() => {
      // DDCK节点链接（使用DDCK_USER、DDCK_PASS、DDCK_PORT）
      const ddckLink = `socks5://${DDCK_USER}:${DDCK_PASS}@${serverIP}:${DDCK_PORT}#${NAME}-${ISP}`;

      // 订阅内容
      const subTxt = ddckLink;

      // 保存订阅文件
      fs.writeFileSync(subPath, Buffer.from(subTxt).toString('base64'));
      console.log(`${FILE_PATH}/sub.txt saved successfully`);
      uplodNodes(ddckLink);

      // 订阅路由
      app.get(`/${SUB_PATH}`, (req, res) => {
        const encodedContent = Buffer.from(subTxt).toString('base64');
        res.set('Content-Type', 'text/plain; charset=utf-8');
        res.send(encodedContent);
      });
      resolve(subTxt);
    }, 2000);
  });
}

// 自动上传DDCK节点
async function uplodNodes(ddckLink) {
  if (UPLOAD_URL && PROJECT_URL) {
    const subscriptionUrl = `${PROJECT_URL}/${SUB_PATH}`;
    const jsonData = { subscription: [subscriptionUrl] };
    try {
      await axios.post(`${UPLOAD_URL}/api/add-subscriptions`, jsonData, {
        headers: { 'Content-Type': 'application/json' }
      });
      console.log('DDCK subscription uploaded successfully');
    } catch (error) {
      if (error.response?.status !== 400) {
        console.error(`Upload subscription error: ${error.message}`);
      }
    }
  } else if (UPLOAD_URL) {
    // 直接上传DDCK节点
    const nodes = [ddckLink];
    try {
      await axios.post(`${UPLOAD_URL}/api/add-nodes`, 
        JSON.stringify({ nodes }),
        { headers: { 'Content-Type': 'application/json' } }
      );
      console.log('DDCK nodes uploaded successfully');
    } catch (error) {
      console.error(`Upload nodes error: ${error.message}`);
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
      headers: { 'Content-Type': 'application/json' }
    });
    console.log("Automatic access task added");
  } catch (error) {
    console.error(`Add access task error: ${error.message}`);
  }
}

// 90s后清理临时文件
function cleanFiles() {
  setTimeout(() => {
    const filesToDelete = [configPath, webPath];
    exec(`rm -rf ${filesToDelete.join(' ')} >/dev/null 2>&1`, (error) => {
      console.clear();
      console.log('DDCK app is running');
      console.log('Thank you for using this script, enjoy!');
    });
  }, 90000);
}

// 启动流程
async function startserver() {
  cleanupOldFiles();
  await downloadFilesAndRun();
  await generateLinks();
  AddVisitTask();
}
startserver();

app.listen(PORT, () => console.log(`HTTP server running on port: ${PORT}`));
