/**
 * Windsurf 账号自动注册脚本（修复版）
 *
 * 依赖windows/powershel：
 *   winget install OpenJS.NodeJS.LTS
 *   Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
 *   npm install
 *   node register_windsurf.js 
 *
 * 运行：
 *   node register_windsurf.js
 *
 * 修复项：
 *  1. 选择器 `:has-text()` 改为 Puppeteer 20+ 原生 `::-p-text()`。
 *  2. IMAP 搜索不再使用正则，改为 SEARCH + 本地过滤，并只匹配脚本启动后收到的邮件。
 *  3. 邮件正文用 mailparser 正确解码（base64 / quoted-printable / multipart）。
 *  4. OTP 输入框兼容 1 个 / 6 个两种页面结构。
 *  5. 关键步骤用 waitForSelector 代替硬 delay。
 *  6. 任何异常都截图 error.png，并确保 browser 一定关闭。
 */

const { connect } = require('puppeteer-real-browser');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const delay = require('delay');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// 在没有 Chrome 时,自动使用系统里已有的 Edge(Windows 默认自带)
function detectBrowserPath() {
  if (process.platform !== 'win32') return undefined;
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

// ====================== 随机生成器 ======================
function randStr(len, chars) {
  let s = '';
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) s += chars[bytes[i] % chars.length];
  return s;
}
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGIT = '0123456789';

// firstName: 8 位纯字母（Windsurf 校验 "valid name" 不允许数字）
function genFirstName() {
  return randStr(8, LOWER);
}
// lastName: 6 位纯字母
function genLastName() {
  return randStr(6, LOWER);
}
// password: 使用固定密码
const FIXED_PASSWORD = 'new-api.ai2026';

// ====================== 配置 ======================
const CONFIG = {
  // 以下字段在每次注册时由 refreshCredentials() 重新生成
  firstName: '',
  lastName: '',
  email: '',
  password: FIXED_PASSWORD,
  confirmPassword: FIXED_PASSWORD,

  // 收验证码的 IMAP。注意：如果  是通过 Cloudflare Email Routing
  // 转发到 Gmail 等第三方邮箱，这里要填那个第三方邮箱的 IMAP，而不是 chukk.ai。
  // 注意：必须是 IMAP（不是 POP3）。阿里企业邮 IMAP: imap.mxhichina.com:993
  imap: {
    host: 'imap.mxhichina.com',
    port: 993,
    secure: true,
    auth: {
      user: 'chukk@chukk.cn',
      pass: 'xxxxxx',
    },
    logger: false,
  },

  // 发件人白名单（Windsurf 验证邮件常见发件域名）
  mailFromAllow: [
    'no-reply@codeium.com',
    'noreply@codeium.com',
    'no-reply@windsurf.com',
    'noreply@windsurf.com',
  ],
};
// ==================================================

function refreshCredentials() {
  const fn = genFirstName();
  const ln = genLastName();
  CONFIG.firstName = fn;
  CONFIG.lastName = ln;
  CONFIG.email = `${fn}@proxyai.vip`;
}

// ====================== 保存账号到文件 ======================
function saveAccountToFile(email, password) {
  const today = new Date();
  const dateStr = today.toISOString().split('T')[0]; // YYYY-MM-DD
  const filename = path.join(__dirname, `accounts_${dateStr}.txt`);
  const line = `${email}|${password}\n`;
  
  fs.appendFileSync(filename, line);
  console.log(`📁 已保存账号到文件: ${filename}`);
}
// ==================================================

/**
 * 从 IMAP 最新邮件中提取 6 位验证码。
 * 只匹配指定时间之后收到、收件人匹配 targetEmail、且发件人在白名单内的邮件。
 * 优先返回最新一封匹配邮件的验证码，避免重复使用过期验证码。
 */
async function fetchVerificationCode(startTime, targetEmail) {
  const client = new ImapFlow(CONFIG.imap);
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  try {
    // 服务端按日期粗筛，本地再精细过滤
    const uids = await client.search({ since: startTime }, { uid: true });
    if (!uids || uids.length === 0) return null;

    // 取最近的若干封，倒序检查（最新的优先）
    const recent = uids.slice(-20).reverse();
    const targetLower = targetEmail.toLowerCase();

    for (const uid of recent) {
      const msg = await client.fetchOne(
        uid,
        { source: true, envelope: true, internalDate: true },
        { uid: true }
      );
      if (!msg) continue;
      if (msg.internalDate && new Date(msg.internalDate) < startTime) continue;

      // 发件人白名单过滤
      const fromAddr =
        msg.envelope &&
        msg.envelope.from &&
        msg.envelope.from[0] &&
        (msg.envelope.from[0].address || '').toLowerCase();
      if (fromAddr && !CONFIG.mailFromAllow.includes(fromAddr)) continue;

      // 收件人过滤：To 列表中必须包含当前注册邮箱
      const toAddrs =
        msg.envelope && msg.envelope.to
          ? msg.envelope.to.map((t) => (t.address || '').toLowerCase())
          : [];
      if (!toAddrs.includes(targetLower)) continue;

      const parsed = await simpleParser(msg.source);
      const haystack = [parsed.subject, parsed.text, parsed.html]
        .filter(Boolean)
        .join('\n');

      const match = haystack.match(/\b(\d{6})\b/);
      if (match) {
        console.log(`📬 匹配到邮件: To=${targetEmail}, Date=${msg.internalDate}, Code=${match[1]}`);
        return match[1];
      }
    }
    return null;
  } finally {
    lock.release();
    await client.logout();
  }
}

/**
 * 在一组候选选择器里取第一个能匹配到的；都不到则抛错。
 */
async function waitAnySelector(page, selectors, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (const sel of selectors) {
      const el = await page.$(sel);
      if (el) return { selector: sel, handle: el };
    }
    await delay(300);
  }
  throw new Error(`等待选择器超时: ${selectors.join(' | ')}`);
}

async function typeInto(page, selectors, value) {
  const { selector } = await waitAnySelector(page, selectors, 20000);
  await page.click(selector, { clickCount: 3 }).catch(() => {});
  await page.type(selector, value, { delay: 60 });
}

/**
 * 按文本点击按钮。Puppeteer 20+ 支持 ::-p-text() 伪类。
 * 为稳妥起见，做一次 DOM 兜底查询。
 */
async function clickButtonByText(page, text) {
  // 先尝试原生 text 选择器
  try {
    await page.waitForSelector(`button::-p-text(${text})`, { timeout: 5000 });
    await page.click(`button::-p-text(${text})`);
    return;
  } catch (_) {
    // 兜底：在页面上下文中查找
  }
  const clicked = await page.evaluate((t) => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(
      (b) => b.textContent && b.textContent.trim().toLowerCase() === t.toLowerCase()
    );
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  }, text);
  if (!clicked) throw new Error(`未找到文本为 "${text}" 的按钮`);
}

/**
 * 填写 OTP。兼容"1 个大 input"与"6 个小 input"两种形式。
 */
async function fillOtp(page, code) {
  await page.waitForSelector('input[autocomplete="one-time-code"]', {
    timeout: 30000,
  });
  const inputs = await page.$$('input[autocomplete="one-time-code"]');
  if (inputs.length === 1) {
    await inputs[0].type(code, { delay: 60 });
  } else if (inputs.length >= 6) {
    for (let i = 0; i < 6; i++) {
      await inputs[i].type(code[i], { delay: 60 });
    }
  } else {
    throw new Error(`意外的 OTP 输入框数量: ${inputs.length}`);
  }
}

async function registerOne(browser) {
  refreshCredentials();
  console.log('🎲 随机生成的账号信息：');
  console.log('  firstName:', CONFIG.firstName);
  console.log('  lastName :', CONFIG.lastName);
  console.log('  email    :', CONFIG.email);
  console.log('  password :', CONFIG.password);

  // 为每次注册创建独立的无痕上下文,互不干扰
  let ctx = null;
  let page = null;
  try {
    const createIncognito =
      browser.createIncognitoBrowserContext ||
      browser.createBrowserContext;
    if (typeof createIncognito === 'function') {
      ctx = await createIncognito.call(browser);
      page = await ctx.newPage();
      console.log('🕶️ 已创建新的无痕上下文');
    } else {
      page = await browser.newPage();
      console.log('📄 已创建新标签页');
    }
    page.setDefaultTimeout(90000);
    try {
      await page.setViewport({ width: 1920, height: 1080 });
    } catch (_) {}

    // 1. 打开注册页
    await page.goto('https://windsurf.com/account/register', {
      waitUntil: 'domcontentloaded',
    });

    // 2. 第一步：填写基本信息
    console.log('✍️ 第一步：填写基本信息');
    await typeInto(
      page,
      [
        'input[name="firstName"]',
        'input[name="first_name"]',
        'input[placeholder="Your first name" i]',
        'input[autocomplete="given-name"]',
      ],
      CONFIG.firstName
    );
    await typeInto(
      page,
      [
        'input[name="lastName"]',
        'input[name="last_name"]',
        'input[placeholder="Your last name" i]',
        'input[autocomplete="family-name"]',
      ],
      CONFIG.lastName
    );
    await typeInto(
      page,
      [
        'input[name="email"]',
        'input[type="email"]',
        'input[autocomplete="email"]',
      ],
      CONFIG.email
    );

    // 勾选服务条款（若未勾选）
    const checkbox = await page.$('input[type="checkbox"]');
    if (checkbox) {
      const checked = await checkbox.evaluate((el) => el.checked);
      if (!checked) {
        // 直接触发 click，兼容自定义样式的 checkbox
        await checkbox.evaluate((el) => el.click());
      }
    }
    await delay(300);

    // 进入第二步
    console.log('➡️ 进入第二步：设置密码');
    await clickButtonByText(page, 'Continue');

    // 3. 第二步：密码
    console.log('🔐 填写密码');
    await typeInto(
      page,
      [
        'input[name="password"]',
        'input[type="password"][autocomplete="new-password"]',
        'input[type="password"]:nth-of-type(1)',
      ],
      CONFIG.password
    );
    await typeInto(
      page,
      [
        'input[name="passwordConfirmation"]',
        'input[name="password_confirmation"]',
        'input[name="confirmPassword"]',
        'input[name="confirm_password"]',
        'input[type="password"]:nth-of-type(2)',
      ],
      CONFIG.confirmPassword
    );
    await delay(500);

    console.log('📤 提交密码');
    // 记录提交密码的时间（往前留10秒冗余），用于过滤验证码邮件
    const codeStartTime = new Date(Date.now() - 10 * 1000);
    await clickButtonByText(page, 'Continue');

    // 4. 第三步：等验证码输入框 + 取验证码
    console.log('📧 等待验证码输入框');
    await page.waitForSelector('input[autocomplete="one-time-code"]', {
      timeout: 30000,
    });

    console.log(`🔍 从邮箱收取验证码... (目标: ${CONFIG.email}, 起始时间: ${codeStartTime.toISOString()})`);
    let code = null;
    for (let i = 0; i < 24; i++) {
      try {
        code = await fetchVerificationCode(codeStartTime, CONFIG.email);
      } catch (e) {
        console.warn(`IMAP 读取失败(${i + 1}): ${e.message}`);
      }
      if (code) break;
      
      // 未收到验证码，尝试点击 Resend code
      if (i > 0 && i % 6 === 0) { // 每隔约30秒尝试重发
        console.log('📤 尝试重新发送验证码...');
        try {
          await clickButtonByText(page, 'Resend code');
          console.log('✅ 已点击 Resend code');
          await delay(2000);
        } catch (e) {
          console.warn(`点击 Resend code 失败: ${e.message}`);
        }
      }
      
      console.log(`未收到，重试 ${i + 1}/24`);
      await delay(5000);
    }

    if (!code) {
      throw new Error('超时未获取到验证码');
    }
    console.log('✅ 收到验证码:', code);

    // 5. 填写验证码(填完 6 位后,Windsurf 通常会自动提交并跳转)
    await fillOtp(page, code);

    // 辅助:判断页面是否已离开注册页
    const isLeftRegister = () => !/\/account\/register/.test(page.url());

    // 6. 等待自动提交 + 跳转;不行再点按钮兜底
    let autoSubmitted = false;
    try {
      await page.waitForFunction(
        () => !/\/account\/register/.test(location.pathname),
        { timeout: 10000 }
      );
      autoSubmitted = true;
      console.log('✅ OTP 已自动提交,页面已跳转');
    } catch (_) {}

    if (!autoSubmitted) {
      // 先等 3 秒,给网络请求留出跳转时间
      await delay(3000);
      if (isLeftRegister()) {
        autoSubmitted = true;
        console.log('✅ 页面已跳转(延迟检测)');
      }
    }

    if (!autoSubmitted) {
      console.log('✅ 手动提交验证');
      try {
        await clickButtonByText(page, 'Create account');
      } catch (e) {
        // 点击失败再给 3 秒看是否其实已跳转
        await delay(3000);
        if (isLeftRegister()) {
          console.log('(按钮消失但页面已跳转,视为已自动提交)');
        } else {
          throw e;
        }
      }
    }

    // 等待跳转或成功提示
    let registered = false;
    try {
      // 方案1: URL 变化
      await page.waitForFunction(
        () => !/\/account\/register/.test(location.pathname),
        { timeout: 30000 }
      );
      registered = true;
    } catch (_) {}
    
    if (!registered) {
      try {
        // 方案2: 检查成功提示文本
        await page.waitForSelector('text/Dashboard', { timeout: 10000 });
        registered = true;
      } catch (_) {}
    }
    
    if (!registered) {
      try {
        // 方案3: 检查错误提示是否出现（如果有错误说明没成功）
        const errorMsg = await page.$('text/Invalid code, please try again');
        if (errorMsg) {
          throw new Error('验证码错误');
        }
      } catch (_) {}
    }

    if (!registered) {
      try {
        // 方案4: 检测 cookie 同意按钮或保存密码按钮（注册成功后的常见弹窗）
        await page.waitForSelector('button::-p-text(Accept), button::-p-text(Accept All), button::-p-text(Save password), button::-p-text(Save Password)', { timeout: 5000 });
        registered = true;
      } catch (_) {}
    }

    if (!registered) {
      try {
        // 方案5: URL 包含 onboarding 或 account 之外的其他路径
        const currentUrl = page.url();
        if (currentUrl.includes('onboarding') || (currentUrl.includes('account') && !currentUrl.includes('register'))) {
          registered = true;
        }
      } catch (_) {}
    }

    // 如果检测到 cookie 弹窗自动点击
    if (registered) {
      try {
        // 点击 Accept/Accept All
        await page.waitForSelector('button::-p-text(Accept), button::-p-text(Accept All)', { timeout: 3000 });
        await clickButtonByText(page, 'Accept').catch(() => clickButtonByText(page, 'Accept All'));
      } catch (_) {}
      
      console.log('🎉 注册成功！');
    } else {
      console.log('⚠️ 未检测到跳转，请人工确认结果');
    }

    console.log('账号信息：');
    console.log('  邮箱:', CONFIG.email);
    console.log('  密码:', CONFIG.password);
    
    // 保存账号到文件
    saveAccountToFile(CONFIG.email, CONFIG.password);
  } catch (err) {
    console.error('❌ 出错:', err.message);
    try {
      if (page) await page.screenshot({ path: 'error.png', fullPage: true });
      console.error('已保存截图 error.png');
    } catch (_) {}
    throw err;
  } finally {
    // 关闭本次注册的上下文/页面,不关闭浏览器
    try {
      if (ctx) await ctx.close();
      else if (page) await page.close();
    } catch (_) {}
  }
}

// 浏览器关闭时 chrome-launcher 在 Windows 上偶尔无法删除 %TEMP%\lighthouse.* 目录,
// 这对注册结果没有影响,忽略这类 EPERM,避免进程以非 0 退出。
function isHarmlessCleanupErr(err) {
  return (
    err &&
    err.code === 'EPERM' &&
    typeof err.path === 'string' &&
    /lighthouse\.|windsurf-/.test(err.path)
  );
}
process.on('uncaughtException', (err) => {
  if (isHarmlessCleanupErr(err)) {
    console.warn('⚠️ 忽略浏览器临时目录清理错误:', err.path);
    return;
  }
  console.error(err);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  if (isHarmlessCleanupErr(err)) return;
  console.error(err);
});

async function main() {
  const count = parseInt(process.argv[2], 10) || 1;

  console.log('🚀 启动防风控浏览器...');
  const browserPath = detectBrowserPath();
  if (browserPath) {
    console.log(`🧭 使用浏览器: ${browserPath}`);
  }
  const customConfig = {
    chromeFlags: [
      '--incognito',
      '--start-maximized',
      '--start-fullscreen',
      '--no-default-browser-check',
      '--disable-restore-session-state',
    ],
  };
  if (browserPath) customConfig.chromePath = browserPath;

  const connected = await connect({
    headless: false,
    turnstile: true,
    fingerprint: true,
    customConfig,
    connectOption: { defaultViewport: null },
  });
  const browser = connected.browser;

  // 关闭 connect 默认打开的空白页
  try {
    if (connected.page) await connected.page.close();
  } catch (_) {}

  let success = 0;
  let fail = 0;

  console.log('================================================');
  console.log(`  Windsurf Auto Register — Count: ${count}`);
  console.log('================================================');

  for (let i = 1; i <= count; i++) {
    console.log(`\n========== [${i}/${count}] ==========`);
    try {
      await registerOne(browser);
      success++;
      console.log(`✅ [${i}/${count}] OK (success: ${success})`);
    } catch (e) {
      fail++;
      console.log(`❌ [${i}/${count}] FAIL (fail: ${fail}): ${e.message}`);
    }
    if (i < count) {
      console.log('⏳ 等待 3 秒...');
      await delay(3000);
    }
  }

  console.log('\n================================================');
  console.log(`  Done — Success: ${success}, Fail: ${fail}`);
  console.log('================================================');

  try {
    await browser.close();
  } catch (_) {}
}

main();
