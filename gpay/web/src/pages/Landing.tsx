import { ArrowRight, BadgePercent, Code2, FileText, Link2, Lock, QrCode, Receipt, RotateCcw, ShieldCheck, Webhook, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { CardLogos, PayLogo } from '../components/PaymentLogos';
import { Button, cx } from '../components/ui';
import { useAuth } from '../lib/auth';

const FEATURES = [
  { icon: Zap, title: 'Все популярные способы', text: 'Карты МИР, Visa, Mastercard, UnionPay, СБП, оплата частями и криптовалюта — на одной странице оплаты.' },
  { icon: Receipt, title: 'Онлайн-касса и чеки', text: 'Чеки по 54-ФЗ формируются автоматически: приход, возврат прихода, QR для проверки. PDF в один клик.' },
  { icon: Link2, title: 'Ссылки и счета', text: 'Принимайте оплату без сайта: ссылка в мессенджере, счёт с позициями или QR-табличка на кассе.' },
  { icon: Code2, title: 'REST API и виджет', text: 'Идемпотентные запросы, двухстадийные платежи, возвраты и выплаты. Виджет оплаты подключается одной строкой.' },
  { icon: Webhook, title: 'Вебхуки с подписью', text: 'Уведомления о статусах с HMAC-SHA256, автоповторы в течение суток и журнал доставок.' },
  { icon: ShieldCheck, title: 'Безопасность', text: 'PCI DSS, 3-D Secure 2.0 и антифрод. Данные карт не попадают на сервер магазина.' },
];

const TARIFFS = [
  { title: 'Банковские карты', pct: '2,8%', sub: 'МИР, Visa, Mastercard, UnionPay' },
  { title: 'СБП', pct: '0,7%', sub: 'Оплата по QR-коду' },
  { title: 'Оплата частями', pct: '4,9%', sub: 'Деньги магазину сразу' },
  { title: 'Криптовалюта', pct: '1,5%', sub: 'USDT, Bitcoin' },
];

export default function Landing() {
  const { user } = useAuth();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 bg-bg/80 backdrop-blur border-b border-line/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Logo />
          <nav className="flex items-center gap-1 sm:gap-2">
            <Link to="/docs" className="hidden sm:inline-flex h-9 items-center px-3 text-sm text-muted hover:text-fg">Документация</Link>
            {user ? (
              <Link to="/app"><Button variant="primary" size="sm">Личный кабинет</Button></Link>
            ) : (
              <>
                <Link to="/login" className="inline-flex h-9 items-center px-3 text-sm text-muted hover:text-fg">Войти</Link>
                <Link to="/register"><Button variant="primary" size="sm">Подключиться</Button></Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(60%_60%_at_70%_0%,var(--color-brand-soft),transparent_70%)]" />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-14 sm:pt-20 pb-16 grid lg:grid-cols-[1.1fr_1fr] gap-12 items-center">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted shadow-card">
              <BadgePercent className="size-3.5 text-brand" /> СБП — от 0,7% за платёж
            </span>
            <h1 className="mt-5 text-[40px] sm:text-[56px] leading-[1.03] font-semibold tracking-[-0.035em]">
              Приём платежей <span className="text-brand">для бизнеса</span> любого размера
            </h1>
            <p className="mt-5 text-lg text-muted max-w-xl">Интернет-эквайринг, онлайн-касса, ссылки на оплату и API для разработчиков. Подключение за 5 минут, деньги на счёт — на следующий день.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to={user ? '/app' : '/register'}><Button variant="primary" size="lg" icon={<ArrowRight className="size-4" />}>Начать принимать платежи</Button></Link>
              <Link to="/docs"><Button size="lg" icon={<Code2 className="size-4" />}>API для разработчиков</Button></Link>
            </div>
            <div className="mt-8 flex items-center gap-3 text-xs text-muted">
              <CardLogos />
              <PayLogo name="sbp" />
              <PayLogo name="tether" />
              <PayLogo name="bitcoin" />
            </div>
          </div>
          <HeroMock />
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
        <h2 className="text-3xl font-semibold tracking-tight">Всё для оплаты в одном сервисе</h2>
        <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-line bg-surface p-6 shadow-card">
              <span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand"><f.icon className="size-5" /></span>
              <div className="mt-4 font-semibold">{f.title}</div>
              <p className="mt-1.5 text-sm text-muted">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
        <div className="rounded-3xl bg-[#0f0d24] text-white p-8 sm:p-12 grid lg:grid-cols-2 gap-10 items-center overflow-hidden relative">
          <div className="absolute -right-20 -top-20 size-80 rounded-full bg-[#5b3df5]/40 blur-3xl" />
          <div className="relative">
            <h2 className="text-3xl font-semibold tracking-tight">Платёж — три строки кода</h2>
            <p className="mt-3 text-white/70">Создайте платёж на сервере, перенаправьте покупателя на confirmation_url и получите вебхук <span className="font-mono">payment.succeeded</span>.</p>
            <Link to="/docs" className="inline-block mt-6"><Button variant="primary" icon={<ArrowRight className="size-4" />}>Открыть документацию</Button></Link>
          </div>
          <pre className="relative rounded-2xl bg-black/40 border border-white/10 p-5 text-[12.5px] leading-relaxed font-mono overflow-x-auto text-white/90">
{`curl ${location.origin}/api/v1/payments \\
  -H "Authorization: Bearer sk_live_…" \\
  -H "Idempotence-Key: 7d1f…" \\
  -d '{
    "amount": { "value": "1290.00", "currency": "RUB" },
    "description": "Заказ №4821",
    "confirmation": {
      "type": "redirect",
      "return_url": "https://shop.ru/thanks"
    }
  }'`}
          </pre>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
        <h2 className="text-3xl font-semibold tracking-tight">Прозрачные тарифы</h2>
        <p className="mt-2 text-muted">Без абонентской платы, подключение бесплатно.</p>
        <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {TARIFFS.map((t, i) => (
            <div key={t.title} className={cx('rounded-2xl border p-6', i === 1 ? 'border-brand bg-brand-soft' : 'border-line bg-surface shadow-card')}>
              <div className="text-sm text-muted">{t.title}</div>
              <div className="mt-2 text-4xl font-semibold tracking-tight">{t.pct}</div>
              <div className="mt-2 text-sm text-muted">{t.sub}</div>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-line mt-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 flex flex-col sm:flex-row gap-6 justify-between text-sm text-muted">
          <div>
            <Logo size="sm" />
            <p className="mt-3 max-w-sm text-xs text-faint">GnusaPay — сервис приёма платежей для интернет-магазинов, приложений и офлайн-бизнеса.</p>
          </div>
          <div className="flex gap-8">
            <div className="flex flex-col gap-2"><span className="text-fg font-medium">Продукты</span><span>Эквайринг</span><span>Онлайн-касса</span><span>Ссылки на оплату</span></div>
            <div className="flex flex-col gap-2"><span className="text-fg font-medium">Разработчикам</span><Link to="/docs">Документация API</Link><Link to="/docs#widget">Виджет оплаты</Link><Link to="/docs#webhooks">Вебхуки</Link></div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function HeroMock() {
  return (
    <div className="relative mx-auto w-full max-w-[420px]">
      <div className="absolute -inset-6 -z-10 rounded-[40px] bg-[conic-gradient(from_200deg,#7a5cff33,#22d3ee22,#f472b622,#7a5cff33)] blur-2xl" />
      <div className="rounded-3xl border border-line bg-surface shadow-pop p-6">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-[#0f766e] text-white font-semibold">Ф</span>
          <div>
            <div className="text-sm font-semibold">Фитнес-клуб «Пульс»</div>
            <div className="text-xs text-muted">Абонемент на 3 месяца</div>
          </div>
        </div>
        <div className="mt-5 text-4xl font-semibold tracking-tight">9 900 ₽</div>
        <div className="mt-5 grid grid-cols-4 gap-2">
          {['Карта', 'СБП', 'Частями', 'Крипта'].map((t, i) => (
            <div key={t} className={cx('rounded-xl border px-2 py-2 text-xs font-medium', i === 0 ? 'border-brand ring-4 ring-brand/10' : 'border-line text-muted')}>{t}</div>
          ))}
        </div>
        <div className="mt-4 rounded-xl border border-line">
          <div className="h-11 px-3 flex items-center justify-between font-mono text-sm">2200 1234 5678 9012 <PayLogo name="mir" /></div>
          <div className="grid grid-cols-2 border-t border-line font-mono text-sm text-muted">
            <div className="h-11 px-3 flex items-center border-r border-line">09 / 28</div>
            <div className="h-11 px-3 flex items-center">•••</div>
          </div>
        </div>
        <div className="mt-4 h-12 rounded-xl bg-brand text-white flex items-center justify-center gap-2 text-sm font-medium"><Lock className="size-4" /> Оплатить 9 900 ₽</div>
        <div className="mt-4 flex items-center justify-between text-[11px] text-faint">
          <span className="inline-flex items-center gap-1"><ShieldCheck className="size-3.5" /> PCI DSS</span>
          <span className="inline-flex items-center gap-1"><QrCode className="size-3.5" /> Чек по 54-ФЗ</span>
          <span className="inline-flex items-center gap-1"><RotateCcw className="size-3.5" /> Возвраты</span>
          <span className="inline-flex items-center gap-1"><FileText className="size-3.5" /> Счета</span>
        </div>
      </div>
    </div>
  );
}
