import { BootstrapAdminRequestSchema, PASSWORD_MIN_LENGTH, USERNAME_REGEX } from '@crewstation/contracts';
import type { LoginInput } from '../api/moduleApi';
import { escapeHtml, loginPageShell } from './loginPageShell';

const FIELDS = [
  { name: 'token', label: '引导令牌', type: 'password', autocomplete: 'off', min: 1, max: 512, hint: '打开安装输出的初始化链接会自动带入；也可粘贴安装时的一次性引导令牌。' },
  { name: 'username', label: '用户名', type: 'text', autocomplete: 'username', min: 3, max: 48, hint: '3–48 位，以小写字母开头，可使用小写字母、数字、短横线和下划线。' },
  { name: 'displayName', label: '显示名', type: 'text', autocomplete: 'name', min: 1, max: 80, hint: '1–80 个字符，用于在平台中显示你的名字。' },
  { name: 'email', label: '邮箱', type: 'email', autocomplete: 'email', min: 1, max: 254, hint: '必填，请输入有效邮箱地址，最多 254 个字符。' },
  { name: 'password', label: '密码', type: 'password', autocomplete: 'new-password', min: PASSWORD_MIN_LENGTH, max: 200, hint: '12–200 个字符，请自行设置并保存，之后用它登录。' },
  { name: 'confirmPassword', label: '确认密码', type: 'password', autocomplete: 'new-password', min: PASSWORD_MIN_LENGTH, max: 200, hint: '再次输入同一密码。' },
] as const;

function fieldHtml(field: typeof FIELDS[number], input: LoginInput, errors: Map<string, string>): string {
  const name = field.name;
  const value = field.type !== 'password' && typeof input[name] === 'string' ? input[name] as string : '';
  const error = errors.get(name);
  // HTML pattern 按 Unicode v 模式解释，字符组内的短横线必须转义。
  const usernamePattern = USERNAME_REGEX.source.replace('_-', '_\\-');
  return `<div id="${name}-fields">
    <label for="${name}">${field.label}</label>
    <input id="${name}" name="${name}" type="${field.type}" required minlength="${field.min}" maxlength="${field.max}"
      autocomplete="${field.autocomplete}" value="${escapeHtml(value)}" aria-describedby="${name}-hint ${name}-error"
      ${name === 'username' ? `pattern="${escapeHtml(usernamePattern)}" autofocus` : ''} ${error ? 'aria-invalid="true"' : ''}>
    <p id="${name}-hint" class="hint field-hint">${field.hint}</p>
    <p id="${name}-error" class="field-error" aria-live="polite" ${error ? '' : 'hidden'}>${escapeHtml(error ?? '')}</p>
  </div>`;
}

/** 首次访问即展示创建表单；失败只回填非口令资料，令牌与密码不写入响应。 */
export function renderBootstrapPage(error?: string, input: LoginInput = {}): string {
  const errors = new Map<string, string>();
  if (error) {
    const parsed = BootstrapAdminRequestSchema.safeParse(input);
    if (!parsed.success) for (const issue of parsed.error.issues) errors.set(String(issue.path[0]), issue.message);
    if (error === '引导令牌不正确') errors.set('token', error);
  }
  const returnTo = typeof input.returnTo === 'string' ? input.returnTo : '';
  return loginPageShell('创建首位管理员 · CrewStation', `
  <h2>创建首位管理员</h2>
  <p class="notice">欢迎使用 CrewStation。平台尚未初始化，请先设置你的管理员账号。<strong>没有默认用户名或初始密码。</strong></p>
  ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
  <form id="bootstrap-form" method="post" action="/auth/bootstrap">
    ${FIELDS.map((field) => fieldHtml(field, input, errors)).join('')}
    <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}">
    <button type="submit">创建管理员</button>
  </form>
  <p class="hint">创建成功后引导令牌永久失效。接下来用你设置的用户名和密码登录，再配置公司身份登录。</p>
  <details class="hint"><summary>如何取得引导令牌？</summary>
    <p>请使用安装完成时输出的初始化链接，或请安装人员读取 <code>crewstation-secrets</code> 中的 <code>CS_BOOTSTRAP_TOKEN</code>：</p>
    <code>kubectl -n crewstation-system get secret crewstation-secrets -o jsonpath='{.data.CS_BOOTSTRAP_TOKEN}' | base64 -d</code>
  </details>${bootstrapScript}`);
}

// 渐进增强：禁用脚本时仍可提交，后端按同一契约逐字段校验。
const bootstrapScript = `<script>
  const form = document.querySelector('#bootstrap-form');
  const fields = Array.from(form.querySelectorAll('input:not([type="hidden"])'));
  form.noValidate = true;
  function validateField(input) {
    let message = '';
    if (!input.value) message = '请填写此项。';
    else if (!input.validity.valid || input.value.length < input.minLength || input.value.length > input.maxLength)
      message = document.getElementById(input.name + '-hint').textContent;
    else if (input.name === 'confirmPassword' && input.value !== form.elements.password.value)
      message = '两次输入的密码不一致。';
    const error = document.getElementById(input.name + '-error');
    error.textContent = message;
    error.hidden = !message;
    input.setAttribute('aria-invalid', String(!!message));
    return !message;
  }
  fields.forEach((input) => {
    input.addEventListener('blur', () => validateField(input));
    input.addEventListener('input', () => {
      if (input.getAttribute('aria-invalid') === 'true') validateField(input);
      if (input.name === 'password' && form.elements.confirmPassword.value) validateField(form.elements.confirmPassword);
    });
  });
  form.addEventListener('submit', (event) => {
    const invalid = fields.filter((input) => !validateField(input));
    if (invalid.length) {
      event.preventDefault();
      invalid[0].closest('div').hidden = false;
      invalid[0].focus();
    } else {
      form.querySelector('button').disabled = true;
      form.querySelector('button').textContent = '正在创建…';
    }
  });
  document.querySelector('[aria-invalid="true"]')?.focus();
</script>`;
