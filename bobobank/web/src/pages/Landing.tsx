import { ArrowRight, Baby, Briefcase, Crown, Gift, Landmark, PiggyBank, ShieldCheck, Smartphone, Store, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BankCard } from '../components/BankCard';
import { Logo } from '../components/Logo';
import { NetworkLogo, SbpLogo } from '../components/PaymentLogos';
import { Button } from '../components/ui';
import { useAuth } from '../lib/auth';

const demo = (design: string, network: 'mir' | 'visa' | 'mastercard' | 'unionpay', last4: string, kind: 'debit' | 'credit' = 'debit', tariff: 'standard' | 'prime' | 'kids' = 'standard') =>
  ({ design, network, last4, exp: '10/30', holder: 'IVAN PETROV', form: 'plastic', status: 'active', kind, tariff }) as const;

export default function Landing() {
  const { user } = useAuth();
  const nav = useNavigate();
  const go = () => nav(user ? '/app' : '/register');
  return (
    <div className="min-h-dvh bg-bg">
      <header className="sticky top-0 z-30 border-b border-line/60 bg-bg/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link to="/" className="shrink-0"><Logo compact /></Link>
          <nav className="hidden items-center gap-6 text-[15px] font-semibold text-muted md:flex">
            <a href="#cards" className="hover:text-fg">Карты</a>
            <a href="#savings" className="hover:text-fg">Вклады</a>
            <a href="#credits" className="hover:text-fg">Кредиты</a>
            <a href="#business" className="hover:text-fg">Бизнесу</a>
          </nav>
          <div className="flex items-center gap-2">
            {!user && <Button size="sm" variant="ghost" className="hidden min-[360px]:inline-flex" onClick={() => nav('/login')}>Войти</Button>}
            <Button size="sm" variant="primary" onClick={go}>{user ? 'Открыть банк' : <><span className="sm:hidden">Оформить</span><span className="hidden sm:inline">Стать клиентом</span></>}</Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 pt-6 sm:px-6 sm:pt-10">
        <div className="relative overflow-hidden rounded-3xl bg-[#21A038] px-6 py-10 text-white sm:px-12 sm:py-14">
          <div className="relative grid grid-cols-1 items-center gap-10 lg:grid-cols-[1.1fr_1fr]">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-sm font-semibold"><Zap className="size-4" />Карта за 1 минуту, без визита в офис</span>
              <h1 className="mt-4 text-[38px] font-semibold leading-[1.05] sm:text-[56px]">Банк, который<br />всегда с собой</h1>
              <p className="mt-4 max-w-md text-lg text-white/85">Карты МИР, Visa, Mastercard и UnionPay, переводы по номеру телефона, вклады до 18% и кешбэк Бобобонусами за каждую покупку.</p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <Button size="lg" className="!bg-white !text-[#17802c] hover:!bg-white/90" onClick={go}>{user ? 'Перейти в приложение' : 'Оформить карту'}</Button>
                {!user && <Button size="lg" className="!bg-white/15 !text-white hover:!bg-white/25" onClick={() => nav('/login')}>У меня уже есть карта</Button>}
              </div>
            </div>
            <div className="relative mx-auto h-[230px] w-full max-w-[420px] origin-top scale-[0.82] min-[400px]:scale-90 sm:h-[300px] sm:scale-100">
              <div className="absolute left-0 top-6 -rotate-[10deg]"><BankCard card={demo('black', 'visa', '4417')} /></div>
              <div className="absolute right-0 top-0 rotate-[8deg]"><BankCard card={demo('prime', 'mastercard', '9001', 'debit', 'prime')} /></div>
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2"><BankCard card={demo('green', 'mir', '2026')} /></div>
            </div>
          </div>
        </div>
      </section>

      {/* Products */}
      <section id="cards" className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <h2 className="text-[30px] font-semibold sm:text-[40px]">Всё для денег — в одном приложении</h2>
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Product icon={<Smartphone className="size-6" />} title="Дебетовая карта" text="Бесплатно навсегда. Выпуск виртуальной — сразу после регистрации." tone="bg-surface" />
          <Product id="credits" icon={<Landmark className="size-6" />} title="Кредитная карта" text="120 дней без процентов на покупки, решение за минуту." tone="bg-[#e7efff] dark:bg-[#151d33]" />
          <Product id="savings" icon={<PiggyBank className="size-6" />} title="Вклады до 18%" text="Проценты каждый день с капитализацией, накопительный счёт 14%." tone="bg-[#fff4dc] dark:bg-[#2c2113]" />
          <Product icon={<Gift className="size-6" />} title="Бобобонусы" text="Кешбэк за каждую покупку и 3 категории с повышенным процентом." tone="bg-surface" />
          <Product icon={<Baby className="size-6" />} title="Детская карта" text="Лимиты и уведомления родителю, яркий космический дизайн." tone="bg-[#efeaff] dark:bg-[#1f1a33]" />
          <Product icon={<ShieldCheck className="size-6" />} title="Безопасные покупки" text="Каждую оплату в интернете подтверждаете в приложении." tone="bg-brand-soft" />
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-2 text-sm text-muted">
          Платёжные системы: <NetworkLogo network="mir" className="border border-line" /><NetworkLogo network="visa" className="border border-line" /><NetworkLogo network="mastercard" className="border border-line" /><NetworkLogo network="unionpay" className="border border-line" /><SbpLogo className="border border-line" />
        </div>
      </section>

      {/* Prime */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid grid-cols-1 items-center gap-8 overflow-hidden rounded-3xl bg-[#1C1C1E] p-6 text-white sm:p-12 lg:grid-cols-2">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-[#f3d78a]/15 px-3 py-1 text-sm font-semibold text-[#f3d78a]"><Crown className="size-4" />Bobo Prime</span>
            <h2 className="mt-4 text-[30px] font-semibold leading-tight sm:text-[40px]">Кешбэк до 7% и переводы без комиссии</h2>
            <p className="mt-3 text-white/70">1,5% на всё, 7% в трёх любимых категориях, переводы до 1 млн ₽ в месяц бесплатно и золотая карта. 399 ₽ в месяц.</p>
            <Button size="lg" className="mt-6 !bg-[#f3d78a] !text-[#2a1d05]" onClick={go}>Подключить Prime</Button>
          </div>
          <div className="flex justify-center"><BankCard card={demo('prime', 'visa', '7777', 'debit', 'prime')} size="lg" /></div>
        </div>
      </section>

      {/* Business + GPAY */}
      <section id="business" className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-3xl bg-surface p-6 sm:p-10">
            <Briefcase className="size-8 text-brand" />
            <h2 className="mt-4 text-[26px] font-semibold sm:text-[32px]">Счёт для ИП и ООО</h2>
            <p className="mt-2 text-muted">Открытие онлайн за минуту, бизнес-карта, реквизиты и выписки в PDF.</p>
          </div>
          <div className="rounded-3xl bg-[#111] p-6 text-white sm:p-10">
            <Store className="size-8" />
            <h2 className="mt-4 text-[26px] font-semibold sm:text-[32px]">Принимайте оплату через GPAY</h2>
            <p className="mt-2 text-white/70">Подключите магазин к платёжному сервису GPAY — выручка будет приходить на счёт в Bobobank, а клиенты Bobobank платят в один клик через СБП.</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <div className="flex flex-col items-start justify-between gap-6 rounded-3xl bg-brand p-6 text-on-brand sm:flex-row sm:items-center sm:p-10">
          <div>
            <h2 className="text-[26px] font-semibold sm:text-[32px]">Станьте клиентом за 1 минуту</h2>
            <p className="mt-1 opacity-85">Нужен только номер телефона</p>
          </div>
          <Button size="lg" className="!bg-white !text-[#17802c]" icon={<ArrowRight className="size-5" />} onClick={go}>{user ? 'Открыть банк' : 'Оформить'}</Button>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 text-sm text-muted sm:flex-row sm:justify-between sm:px-6">
          <div>
            <Logo compact />
            <p className="mt-3 max-w-md text-xs leading-relaxed">АО «Бобобанк». Лицензия Банка России № 9909. 123112, г. Москва, Пресненская наб., д. 9. БИК 044599909.</p>
          </div>
          <div className="flex flex-col gap-1">
            <span className="font-semibold text-fg">900</span>
            <span className="text-xs">Бесплатно по России</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Product({ icon, title, text, tone, id }: { icon: ReactNode; title: string; text: string; tone: string; id?: string }) {
  return (
    <div id={id} className={`scroll-mt-24 rounded-2xl p-6 ${tone}`}>
      <span className="flex size-12 items-center justify-center rounded-2xl bg-brand text-on-brand">{icon}</span>
      <h3 className="mt-5 text-xl font-semibold">{title}</h3>
      <p className="mt-1.5 text-muted">{text}</p>
    </div>
  );
}
