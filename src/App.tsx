import { Suspense, useEffect, useState } from 'react'
import { Bell, LogOut, Search } from 'lucide-react'
import BootstrapScreen from './pages/BootstrapScreen'
import LoginScreen from './pages/LoginScreen'
import SearchResults from './components/SearchResult'
import { AppProvider, useApp } from './app/AppProvider'
import {
  screens,
  screenGroups,
  visibleScreensFor,
  type Screen
} from './app/screens'
import { canAccess, roleLabel } from './lib/helpers'
import { Toast } from './shared/ui/Toast'
import DeveloperTools from './components/DeveloperTools'
import BrandMark from './components/BrandMark'

function AppShell() {
  const {
    state,
    screen,
    setScreen,
    phase,
    status,
    currentUser,
    permissions,
    toast,
    login,
    logout,
    saveBootstrapCompany
  } = useApp()
  const [search, setSearch] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [developerToolsOpen, setDeveloperToolsOpen] = useState(false)

  useEffect(() => {
    if (!currentUser) return
    const handler = (event: KeyboardEvent) => {
      if (
        event.ctrlKey &&
        event.shiftKey &&
        event.code === 'KeyD' &&
        currentUser.role === 'owner'
      ) {
        event.preventDefault()
        setDeveloperToolsOpen((value) => !value)
        return
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        document.getElementById('global-search')?.focus()
        return
      }
      if (!event.key.startsWith('F')) return
      const shortcutScreen = Object.entries(screens).find(
        ([, item]) => item.shortcut === event.key
      )?.[0] as Screen | undefined
      if (shortcutScreen && canAccess(permissions?.screens, shortcutScreen)) {
        event.preventDefault()
        setScreen(shortcutScreen)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [currentUser, permissions, setScreen])

  useEffect(() => {
    if (currentUser && !canAccess(permissions?.screens, screen))
      setScreen('dashboard')
  }, [currentUser, permissions, screen, setScreen])

  if (phase === 'loading')
    return <div className="app-loader">جارٍ فتح بيانات المنشأة…</div>
  if (phase === 'import-failed')
    return (
      <main className="login-page" dir="rtl">
        <section className="login-card">
          <div className="login-brand">
            <div className="brand-mark">م</div>
            <div>
              <h1>مدير التعبئة</h1>
              <p>تعذر فتح البيانات</p>
            </div>
          </div>
          <div className="login-copy">
            <h2>مشكلة في ترحيل البيانات القديمة</h2>
            <p>
              {status?.legacyImport.message ||
                'حدث خطأ غير متوقع أثناء تجهيز قاعدة البيانات.'}
            </p>
            {status?.legacyImport.backupPath && (
              <p className="text-secondary">
                نسخة احتياطية قبل الترحيل: {status.legacyImport.backupPath}
              </p>
            )}
          </div>
          <p className="login-security">
            لم تُفقد أي بيانات؛ أعد تشغيل التطبيق أو راجع الدعم الفني مع رسالة
            الخطأ أعلاه.
          </p>
        </section>
      </main>
    )
  if (phase === 'bootstrap')
    return <BootstrapScreen onDone={saveBootstrapCompany} />
  if (phase === 'login' || !currentUser || !state)
    return <LoginScreen onLogin={login} dataMode={status?.dataMode} />

  const visibleScreens = visibleScreensFor(permissions?.screens)
  const ActiveScreen = screens[screen].component
  return (
    <div className="app">
      <aside
        className={'sidebar ' + (sidebarCollapsed ? 'sidebar-collapsed' : '')}
      >
        <div className="brand">
          <button
            className="brand-logo-toggle"
            aria-label={sidebarCollapsed ? 'فتح القائمة الجانبية' : 'طي القائمة الجانبية'}
            aria-expanded={!sidebarCollapsed}
            title={sidebarCollapsed ? 'فتح القائمة الجانبية' : 'طي القائمة الجانبية'}
            onClick={() => setSidebarCollapsed((value) => !value)}
          ><BrandMark size={42} /></button>
          <div className="brand-copy">
            <h1>مدير التعبئة</h1>
            <small>Repack Manager · إصدار ١.٠</small>
          </div>
        </div>
        {screenGroups.map((group) => {
          const entries = visibleScreens.filter(
            ([, item]) => item.group === group
          )
          if (!entries.length) return null
          return (
            <div key={group}>
              <div className="nav-group">{group}</div>
              <nav className="nav">
                {entries.map(([key, item]) => {
                  const Icon = item.icon
                  const selected = key as Screen
                  const pendingReminders =
                    selected === 'reminders'
                      ? state.reminders.filter(
                          (reminder) => reminder.status === 'pending'
                        ).length
                      : 0
                  return (
                    <button
                      key={key}
                      className={screen === selected ? 'active' : ''}
                      onClick={() => setScreen(selected)}
                    >
                      <Icon size={17} />
                      <span className="nav-label">{item.label}</span>
                      {pendingReminders > 0 && (
                        <span className="badge">{pendingReminders}</span>
                      )}
                    </button>
                  )
                })}
              </nav>
            </div>
          )
        })}
        <div className="profile">
          <div className="avatar">{currentUser.displayName.slice(0, 2)}</div>
          <div className="profile-copy">
            <b>{currentUser.displayName}</b>
            <span>{roleLabel(currentUser.role)}</span>
          </div>
          <button
            className="profile-logout"
            onClick={() => {
              void logout()
            }}
            aria-label="تسجيل الخروج"
            title="تسجيل الخروج"
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <main className="content">
        <header className="topbar">
          <div>
            <div className="breadcrumb">
              مدير التعبئة / {screens[screen].label}
            </div>
            <h1 className="page-title">{screens[screen].label}</h1>
          </div>
          <div className="top-actions">
            {status?.dataMode === 'demo' && <span className="demo-mode-badge">وضع البيانات التجريبية</span>}
            <div className="search">
              <Search size={17} />
              <input
                id="global-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="ابحث عن صنف أو عميل أو فاتورة…"
              />
              <kbd>Ctrl K</kbd>
            </div>
            {canAccess(permissions?.screens, 'reminders') && (
              <button
                className="icon-button"
                aria-label="الإشعارات"
                onClick={() => setScreen('reminders')}
              >
                <Bell size={18} />
                <i />
              </button>
            )}
          </div>
        </header>
        {search && (
          <SearchResults
            state={state}
            query={search}
            onPick={(next) => {
              setSearch('')
              if (canAccess(permissions?.screens, next)) setScreen(next)
            }}
          />
        )}
        <Suspense
          fallback={<div className="app-loader">جارٍ تحميل الشاشة…</div>}
        >
          <ActiveScreen />
        </Suspense>
        <Toast message={toast} />
      </main>
      {developerToolsOpen && (
        <DeveloperTools onClose={() => setDeveloperToolsOpen(false)} />
      )}
    </div>
  )
}

function App() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  )
}

export default App
