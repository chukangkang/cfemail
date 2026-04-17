/**
 * Windsurf 账号自动注册脚本（修复版）
 *
 * 依赖：
 *   npm i puppeteer-real-browser imapflow mailparser delay
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

// ====================== 配置 ======================
const CONFIG = {
  firstName: 'windf2',
  lastName: 'one',
  email: 'windf4@chukk.ai',
  password: 'WindfPass123',
  confirmPassword: 'WindfPass123',

  // 收验证码的 IMAP。注意：如果 chukk.ai 是通过 Cloudflare Email Routing
  // 转发到 Gmail 等第三方邮箱，这里要填那个第三方邮箱的 IMAP，而不是 chukk.ai。
  imap: {
    host: 'imap.chukk.ai',
    port: 993,
    secure: true,
    auth: {
      user: 'windf4@chukk.ai',
      pass: '你的邮箱密码或授权码',
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

// 脚本启动时间：只认这之后收到的邮件
const START_TS = new Date(Date.now() - 60 * 1000); // 往前留 1 分钟冗余

/**
 * 从 IMAP 最新邮件中提取 6 位验证码。
 * 只匹配 START_TS 之后收到、且发件人在白名单内的邮件。
 */
async function fetchVerificationCode() {
  const client = new ImapFlow(CONFIG.imap);
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  try {
    // 服务端按日期粗筛，本地再精细过滤
    const uids = await client.search({ since: START_TS }, { uid: true });
    if (!uids || uids.length === 0) return null;

    // 取最近的若干封，倒序检查
    const recent = uids.slice(-10).reverse();

    for (const uid of recent) {
      const msg = await client.fetchOne(
        uid,
        { source: true, envelope: true, internalDate: true },
        { uid: true }
      );
      if (!msg) continue;
      if (msg.internalDate && new Date(msg.internalDate) < START_TS) continue;

      // 发件人白名单过滤
      const fromAddr =
        msg.envelope &&
        msg.envelope.from &&
        msg.envelope.from[0] &&
        (msg.envelope.from[0].address || '').toLowerCase();
      if (fromAddr && !CONFIG.mailFromAllow.includes(fromAddr)) continue;

      const parsed = await simpleParser(msg.source);
      const haystack = [parsed.subject, parsed.text, parsed.html]
        .filter(Boolean)
        .join('\n');

      const match = haystack.match(/\b(\d{6})\b/);
      if (match) return match[1];
    }
    return null;
  } finally {
    lock.release();
    await client.logout();
  }
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

async function register() {
  console.log('🚀 启动防风控浏览器...');
  const { page, browser } = await connect({
    headless: false,
    turnstile: true,
    fingerprint: true,
  });
  page.setDefaultTimeout(90000);

  try {
    // 1. 打开注册页
    await page.goto('https://windsurf.com/account/register', {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector('input[name="firstName"]', { timeout: 30000 });

    // 2. 第一步：填写基本信息
    console.log('✍️ 第一步：填写基本信息');
    await page.type('input[name="firstName"]', CONFIG.firstName, { delay: 60 });
    await page.type('input[name="lastName"]', CONFIG.lastName, { delay: 60 });
    await page.type('input[name="email"]', CONFIG.email, { delay: 60 });

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
    await page.waitForSelector('input[name="password"]', { timeout: 20000 });
    console.log('🔐 填写密码');
    await page.type('input[name="password"]', CONFIG.password, { delay: 60 });
    await page.type(
      'input[name="passwordConfirmation"]',
      CONFIG.confirmPassword,
      { delay: 60 }
    );
    await delay(500);

    console.log('📤 提交密码');
    await clickButtonByText(page, 'Continue');

    // 4. 第三步：等验证码输入框 + 取验证码
    console.log('📧 等待验证码输入框');
    await page.waitForSelector('input[autocomplete="one-time-code"]', {
      timeout: 30000,
    });

    console.log('🔍 从邮箱收取验证码...');
    let code = null;
    for (let i = 0; i < 24; i++) {
      try {
        code = await fetchVerificationCode();
      } catch (e) {
        console.warn(`IMAP 读取失败(${i + 1}): ${e.message}`);
      }
      if (code) break;
      console.log(`未收到，重试 ${i + 1}/24`);
      await delay(5000);
    }

    if (!code) {
      throw new Error('超时未获取到验证码');
    }
    console.log('✅ 收到验证码:', code);

    // 5. 填写验证码
    await fillOtp(page, code);
    await delay(800);

    // 6. 点击 Create account
    console.log('✅ 提交验证');
    await clickButtonByText(page, 'Create account');

    // 等待跳转，判断成功（URL 变化或出现仪表盘特征）
    try {
      await page.waitForFunction(
        () => !/\/account\/register/.test(location.pathname),
        { timeout: 60000 }
      );
      console.log('🎉 注册成功！');
    } catch (_) {
      console.log('⚠️ 未检测到跳转，请人工确认结果');
    }

    console.log('账号信息：');
    console.log('  邮箱:', CONFIG.email);
    console.log('  密码:', CONFIG.password);
  } catch (err) {
    console.error('❌ 出错:', err.message);
    try {
      await page.screenshot({ path: 'error.png', fullPage: true });
      console.error('已保存截图 error.png');
    } catch (_) {}
  } finally {
    try {
      await browser.close();
    } catch (_) {}
  }
}

register();
