import { ArrowRight, Check, Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { CardLogos, PayLogo } from '../components/PaymentLogos';
import { QR } from '../components/QR';
import { Button, cx } from '../components/ui';
import { useAuth } from '../lib/auth';

const NAV = [
  { href: '#features', label: 'Возможности' },
  { href: '#pricing', label: 'Тарифы' },
  { href: '/docs', label: 'Разработчикам' },
];

export default function Landing() {
  const { user } = useAuth();
  const cta = user ? '/app' : '/register';
  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-30 bg-bg/95 backdrop-blur-sm">
        <div className="max-w-[1200px] mx-auto px-5 sm:px-8 h-[72px] flex items-center justify-between gap-6">
          <Link to="/"><Logo /></Link>
          <nav className="hidden md:flex items-center gap-8 text-[15px]">
            {NAV.map((n) => (n.href.startsWith('/') ? <Link key={n.href} to={n.href} className="hover:text-muted">{n.label}</Link> : <a key={n.href} href={n.href} className="hover:text-muted">{n.label}</a>))}
          </nav>
          <div className="flex items-center gap-2">
            {user ? (
              <Link to="/app"><Button variant="primary" size="sm">Личный кабинет</Button></Link>
            ) : (
              <>
                <Link to="/login"><Button variant="ghost" size="sm" className="text-fg">Войти</Button></Link>
                <Link to="/register"><Button variant="primary" size="sm">Подключить</Button></Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-[1200px] mx-auto px-5 sm:px-8">
        {/* Hero */}
        <section className="rounded-[40px] bg-sunken mt-2 px-6 sm:px-14 pt-12 sm:pt-16 pb-0 grid lg:grid-cols-[1.15fr_1fr] gap-10 overflow-hidden">
          <div className="pb-12 sm:pb-16 self-center">
            <h1 className="text-[40px] sm:text-[60px] leading-[1.04] font-bold tracking-[-0.035em]">Приём онлайн-платежей для&nbsp;бизнеса</h1>
            <p className="mt-6 text-lg sm:text-xl text-muted max-w-[520px]">Эквайринг, онлайн-касса и ссылки на оплату в одном договоре. Карты, СБП, оплата частями и криптовалюта.</p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link to={cta}><Button variant="primary" size="lg">Подключить GPAY</Button></Link>
              <Link to="/docs"><Button size="lg" className="!bg-surface hover:!bg-hover">Документация API</Button></Link>
            </div>
            <div className="mt-10 flex flex-wrap items-center gap-2">
              <CardLogos />
              <PayLogo name="sbp" />
            </div>
          </div>
          <PhoneMock />
        </section>

        {/* Numbers */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-8 py-16 sm:py-20 border-b border-line">
          {[
            ['от 0,7%', 'комиссия за платёж через СБП'],
            ['5 минут', 'на подключение магазина'],
            ['1 день', 'до зачисления денег на счёт'],
            ['54-ФЗ', 'чеки отправляются автоматически'],
          ].map(([v, t]) => (
            <div key={v}>
              <div className="text-[34px] sm:text-[44px] font-bold tracking-[-0.03em] leading-none">{v}</div>
              <div className="mt-3 text-muted max-w-[220px]">{t}</div>
            </div>
          ))}
        </section>

        {/* Features */}
        <section id="features" className="py-16 sm:py-24 flex flex-col gap-6 scroll-mt-20">
          <h2 className="text-[32px] sm:text-[44px] font-bold tracking-[-0.03em] leading-tight max-w-[760px]">Всё, чтобы принимать оплату на сайте, в приложении и офлайн</h2>
          <Feature
            title="Платёжная форма, которой доверяют"
            text="Карты МИР, Visa, Mastercard и UnionPay, СБП, оплата частями и криптовалюта. 3-D Secure, понятные ошибки и повторная попытка в один клик."
            points={['Адаптивная страница оплаты', 'Виджет поверх вашего сайта', 'Возврат покупателя в магазин']}
            art={<FormArt />}
          />
          <Feature
            reverse
            title="Онлайн-касса уже включена"
            text="Чеки прихода и возврата формируются при каждом платеже и отправляются покупателю. Не нужно покупать кассу и договор с ОФД."
            points={['НДС 0–22% и без НДС', 'QR-код для проверки чека', 'PDF и печать']}
            art={<ReceiptArt />}
          />
          <Feature
            title="Ссылки и счета без сайта"
            text="Создайте ссылку с фиксированной или свободной суммой, выставьте счёт с позициями или распечатайте QR-код для кассы."
            points={['Многоразовые и разовые ссылки', 'Срок действия', 'Статистика переходов и оплат']}
            art={<LinkArt />}
          />
          <Feature
            reverse
            title="API для разработчиков"
            text="REST API с идемпотентными запросами, двухстадийные платежи, возвраты и выплаты. Вебхуки с подписью и журналом доставок."
            points={['Примеры на 4 языках', 'Песочница в документации', 'Подпись HMAC-SHA256']}
            art={<CodeArt />}
            link={{ to: '/docs', label: 'Открыть документацию' }}
          />
        </section>

        {/* Steps */}
        <section className="py-16 sm:py-20 border-t border-line">
          <h2 className="text-[32px] sm:text-[44px] font-bold tracking-[-0.03em] leading-tight">Подключение за три шага</h2>
          <ol className="mt-12 grid md:grid-cols-3 gap-10">
            {[
              ['Регистрация', 'Укажите email и пароль — договор-оферта принимается онлайн.'],
              ['Анкета магазина', 'Название, ИНН и система налогообложения. Проверка занимает секунды.'],
              ['Первый платёж', 'Отправьте ссылку покупателю или подключите API — деньги придут на баланс.'],
            ].map(([t, d], i) => (
              <li key={t}>
                <div className="text-[64px] leading-none font-bold text-line-strong">{i + 1}</div>
                <div className="mt-5 text-xl font-semibold">{t}</div>
                <p className="mt-2 text-muted">{d}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Pricing */}
        <section id="pricing" className="py-16 sm:py-20 border-t border-line scroll-mt-20">
          <h2 className="text-[32px] sm:text-[44px] font-bold tracking-[-0.03em] leading-tight">Тарифы</h2>
          <p className="mt-3 text-lg text-muted">Без абонентской платы. Платите только за успешные платежи.</p>
          <div className="mt-10 rounded-3xl border border-line overflow-hidden">
            {[
              ['Банковские карты', 'МИР, Visa, Mastercard, UnionPay', '2,8%'],
              ['СБП', 'Оплата по QR-коду из приложения банка', '0,7%'],
              ['Оплата частями', '4 платежа для покупателя, деньги магазину сразу', '4,9%'],
              ['Криптовалюта', 'USDT (TRC-20) и Bitcoin', '1,5%'],
            ].map(([t, d, p]) => (
              <div key={t} className="flex items-center justify-between gap-6 px-6 sm:px-8 py-6 border-b border-line last:border-0">
                <div>
                  <div className="text-lg font-semibold">{t}</div>
                  <div className="text-muted mt-0.5">{d}</div>
                </div>
                <div className="text-[28px] sm:text-[32px] font-bold tracking-[-0.02em] tabular-nums">{p}</div>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="my-10 sm:my-16 rounded-[40px] bg-ink text-on-ink px-6 sm:px-14 py-14 sm:py-16 flex flex-col lg:flex-row lg:items-center justify-between gap-8">
          <div>
            <h2 className="text-[32px] sm:text-[44px] font-bold tracking-[-0.03em] leading-tight">Начните принимать платежи сегодня</h2>
            <p className="mt-3 text-lg opacity-70">Подключение бесплатно, первый платёж — через 5 минут.</p>
          </div>
          <Link to={cta} className="shrink-0">
            <Button size="lg" className="!bg-on-ink !text-ink hover:!opacity-90">Подключить GPAY <ArrowRight className="size-4" /></Button>
          </Link>
        </section>
      </main>

      <footer className="bg-sunken mt-10">
        <div className="max-w-[1200px] mx-auto px-5 sm:px-8 py-14 grid sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr] gap-10 text-[15px]">
          <div>
            <Logo />
            <p className="mt-4 text-muted max-w-xs">Сервис приёма платежей для интернет-магазинов, приложений и офлайн-бизнеса.</p>
          </div>
          <FooterCol title="Продукты" links={[['Эквайринг', '#features'], ['Онлайн-касса', '#features'], ['Ссылки и счета', '#features'], ['Тарифы', '#pricing']]} />
          <FooterCol title="Разработчикам" links={[['Документация API', '/docs'], ['Вебхуки', '/docs#webhooks'], ['Виджет оплаты', '/docs#widget'], ['Песочница', '/docs#sandbox']]} />
          <FooterCol title="Аккаунт" links={[['Войти', '/login'], ['Подключиться', '/register']]} />
        </div>
        <div className="max-w-[1200px] mx-auto px-5 sm:px-8 py-6 border-t border-line text-sm text-faint flex flex-wrap justify-between gap-3">
          <span>© {new Date().getFullYear()} GnusaPay</span>
          <span>GPAY — платёжный сервис GnusaPay</span>
        </div>
      </footer>
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div className="flex flex-col gap-3">
      <span className="font-semibold">{title}</span>
      {links.map(([t, h]) => (h.startsWith('/') ? <Link key={t} to={h} className="text-muted hover:text-fg">{t}</Link> : <a key={t} href={h} className="text-muted hover:text-fg">{t}</a>))}
    </div>
  );
}

function Feature({ title, text, points, art, reverse, link }: { title: string; text: string; points: string[]; art: ReactNode; reverse?: boolean; link?: { to: string; label: string } }) {
  return (
    <div className="rounded-[40px] bg-sunken grid lg:grid-cols-2 gap-10 px-6 sm:px-14 py-12 sm:py-14 items-center">
      <div className={cx(reverse && 'lg:order-2')}>
        <h3 className="text-[26px] sm:text-[32px] font-bold tracking-[-0.025em] leading-tight">{title}</h3>
        <p className="mt-4 text-lg text-muted">{text}</p>
        <ul className="mt-6 flex flex-col gap-2.5">
          {points.map((p) => (
            <li key={p} className="flex items-center gap-3"><Check className="size-5 shrink-0" strokeWidth={2.2} />{p}</li>
          ))}
        </ul>
        {link && (
          <Link to={link.to} className="mt-7 inline-flex items-center gap-1.5 font-medium text-brand hover:underline">
            {link.label} <ArrowRight className="size-4" />
          </Link>
        )}
      </div>
      <div className={cx('flex justify-center', reverse && 'lg:order-1')}>{art}</div>
    </div>
  );
}

// ---------- Product illustrations, drawn with the real UI pieces ----------
function PhoneMock() {
  return (
    <div className="flex justify-center lg:justify-end self-end">
      <div className="w-[300px] sm:w-[320px] rounded-t-[44px] border-[10px] border-b-0 border-ink bg-surface px-5 pt-8 pb-10">
        <div className="mx-auto -mt-4 mb-6 h-1.5 w-20 rounded-full bg-sunken" />
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-[#0f766e] text-sm font-semibold text-white">П</span>
          <div className="text-sm">
            <div className="font-semibold">Фитнес-клуб «Пульс»</div>
            <div className="text-muted text-[13px]">Абонемент на 3 месяца</div>
          </div>
        </div>
        <div className="mt-5 text-[32px] font-bold tracking-[-0.02em]">9 900 ₽</div>
        <div className="mt-4 grid grid-cols-3 gap-1 rounded-xl bg-sunken p-1 text-[13px] font-medium text-center">
          <span className="rounded-[10px] bg-surface py-1.5">Карта</span>
          <span className="py-1.5 text-muted">СБП</span>
          <span className="py-1.5 text-muted">Частями</span>
        </div>
        <div className="mt-3 rounded-xl bg-sunken">
          <div className="h-12 px-4 flex items-center justify-between text-[15px] tabular-nums">2200 1234 5678 9012 <PayLogo name="mir" /></div>
          <div className="grid grid-cols-2 border-t border-bg text-[15px] tabular-nums text-muted">
            <div className="h-12 px-4 flex items-center border-r border-bg">09 / 28</div>
            <div className="h-12 px-4 flex items-center">•••</div>
          </div>
        </div>
        <div className="mt-4 h-12 rounded-xl bg-ink text-on-ink flex items-center justify-center gap-2 text-[15px] font-medium"><Lock className="size-4" /> Оплатить 9 900 ₽</div>
      </div>
    </div>
  );
}

function FormArt() {
  return (
    <div className="w-full max-w-[400px] rounded-3xl bg-surface p-6">
      <div className="text-sm text-muted">Способ оплаты</div>
      <div className="mt-3 flex flex-col gap-2">
        {[
          ['Банковская карта', <CardLogos key="c" />],
          ['СБП', <PayLogo key="s" name="sbp" />],
          ['Оплата частями', <span key="p" className="text-sm text-muted">4 × 2 475 ₽</span>],
          ['Криптовалюта', <span key="k" className="inline-flex gap-1"><PayLogo name="tether" /><PayLogo name="bitcoin" /></span>],
        ].map(([t, r], i) => (
          <div key={String(t)} className={cx('flex items-center justify-between gap-3 rounded-xl px-4 h-14', i === 0 ? 'border-[1.5px] border-fg' : 'bg-sunken')}>
            <span className="font-medium text-[15px]">{t}</span>
            <span className="hidden sm:inline-flex">{r}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReceiptArt() {
  return (
    <div className="w-full max-w-[300px] rounded-3xl bg-surface p-6 font-mono text-[12px] leading-relaxed">
      <div className="text-center font-bold">КАССОВЫЙ ЧЕК · ПРИХОД</div>
      <div className="mt-3 border-t border-dashed border-line-strong pt-3">
        <div className="flex justify-between"><span>Капучино × 2</span><span>640.00</span></div>
        <div className="flex justify-between"><span>Круассан</span><span>290.00</span></div>
        <div className="flex justify-between text-muted"><span>НДС 22%</span><span>115.41</span></div>
      </div>
      <div className="mt-3 border-t border-dashed border-line-strong pt-3 flex justify-between font-bold text-[14px]"><span>ИТОГ</span><span>=930.00</span></div>
      <div className="mt-3 text-muted">ФН 7380440512345678<br />ФД 57 · ФП 3829105562</div>
      <QR text="t=20261013T0900&s=930.00&fn=7380440512345678&i=57&fp=3829105562&n=1" className="mt-4 mx-auto size-24 dark:invert" />
    </div>
  );
}

function LinkArt() {
  return (
    <div className="w-full max-w-[380px] rounded-3xl bg-surface p-6">
      <div className="text-sm text-muted">Ссылка на оплату</div>
      <div className="mt-1 text-xl font-semibold">Абонемент на 10 кофе</div>
      <div className="mt-1 text-[28px] font-bold">2 800 ₽</div>
      <div className="mt-4 rounded-xl bg-sunken px-4 h-12 flex items-center font-mono text-[13px] text-muted truncate">pay.gpay/l/LoOoli7ldf</div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        {[['128', 'переходов'], ['94', 'оплаты'], ['263 200 ₽', 'собрано']].map(([v, t]) => (
          <div key={t} className="rounded-xl bg-sunken py-2.5"><div className="font-semibold text-[15px]">{v}</div><div className="text-[12px] text-muted">{t}</div></div>
        ))}
      </div>
    </div>
  );
}

function CodeArt() {
  return (
    <pre className="w-full max-w-[460px] rounded-3xl bg-surface p-6 text-[12.5px] leading-relaxed font-mono overflow-x-auto">
      <span className="text-ok">POST</span> /api/v1/payments{'\n'}
      <span className="text-faint">Idempotence-Key: 7d1f…</span>{'\n\n'}
      {'{\n  "amount": { "value": "1290.00",\n              "currency": "RUB" },\n  "confirmation": {\n    "type": "redirect",\n    "return_url": "https://shop.ru/ok"\n  }\n}'}
    </pre>
  );
}
