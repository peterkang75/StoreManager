import { useState } from "react";
import {
  Home,
  CalendarDays,
  FileText,
  Settings,
  ChevronRight,
  Clock,
  CheckCircle2,
  Megaphone,
  ShoppingCart,
  Package,
  LayoutDashboard,
  Bell,
  MapPin,
} from "lucide-react";

// ── Karrot Design Tokens ───────────────────────────────────────────────────────
const K = {
  primary:     "#ef4444",
  primaryDark: "#e14d00",
  primaryTint: "#fff2ec",
  bg:          "#ffffff",
  fill:        "#f7f8f9",
  disabled:    "#f3f4f5",
  heading:     "#1a1c20",
  body:        "#555d6d",
  caption:     "#868b94",
  placeholder: "#b0b3ba",
  border:      "#dcdee3",
  borderSubtle:"rgba(0,0,0,0.08)",
  success:     "#079171",
  error:       "#fa342c",
  info:        "#217cf9",
  warning:     "#9b7821",
  shadow2:     "0px 2px 10px rgba(0,0,0,0.10)",
  shadow3:     "0px 4px 16px rgba(0,0,0,0.12)",
};

// ── Mock data ──────────────────────────────────────────────────────────────────
const MOCK = {
  name: "Puspa",
  role: null as string | null,
  shift: {
    store: "Sushime",
    storeColor: "#ef4444",
    date: "Mon, 21 Apr",
    start: "11:30",
    end: "18:30",
    hours: 7,
    status: "pending" as "pending" | "approved" | "none",
  },
  payPeriod: { start: "7 Apr", end: "20 Apr", hours: 60.5, cash: 1512.5 },
  notices: [
    { id: "1", title: "Public holiday next Monday", body: "ANZAC Day — confirm your roster by Friday.", date: "19 Apr" },
    { id: "2", title: "New uniform policy", body: "Black apron required from May 1st.", date: "18 Apr" },
  ],
  quickActions: [
    { id: "daily-close", label: "Daily Close Report", sub: "End-of-day summary for managers", icon: FileText },
    { id: "shopping", label: "Shopping List", sub: "View & update store shopping needs", icon: ShoppingCart },
    { id: "storage", label: "Storage Inventory", sub: "Check stock levels", icon: Package },
    { id: "admin", label: "Admin Dashboard", sub: "Manager view", icon: LayoutDashboard, ownerOnly: true },
  ],
};

type Tab = "home" | "schedule" | "timesheets" | "settings";
type HomeSubTab = "myDay" | "shopping" | "storage";

// ── Shared card style ──────────────────────────────────────────────────────────
const cardStyle: React.CSSProperties = {
  background: K.bg,
  border: `1px solid ${K.borderSubtle}`,
  borderRadius: 12,
  boxShadow: K.shadow2,
};

// ── Shift status badge ─────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: "pending" | "approved" | "none" }) {
  const map = {
    pending:  { bg: "#fffbeb", text: "#9b7821", label: "Pending Approval" },
    approved: { bg: "#f0fdf4", text: "#079171", label: "Approved" },
    none:     { bg: K.disabled, text: K.body,   label: "Not Submitted" },
  };
  const { bg, text, label } = map[status];
  return (
    <span style={{
      background: bg, color: text,
      borderRadius: 9999, fontSize: 11, fontWeight: 600,
      padding: "2px 10px", letterSpacing: 0.2,
    }}>
      {label}
    </span>
  );
}

// ── Today's Shift Card ─────────────────────────────────────────────────────────
function ShiftCard({ shift, onSubmit }: {
  shift: typeof MOCK.shift;
  onSubmit: () => void;
}) {
  const [submitted, setSubmitted] = useState(false);

  return (
    <div style={cardStyle}>
      {/* Store header strip */}
      <div style={{
        borderRadius: "12px 12px 0 0",
        background: K.primaryTint,
        borderBottom: `1px solid ${K.borderSubtle}`,
        padding: "10px 16px",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <MapPin size={14} style={{ color: K.primary, flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: K.heading }}>{shift.store}</span>
        <span style={{ marginLeft: "auto" }}>
          <StatusBadge status={submitted ? "pending" : shift.status} />
        </span>
      </div>

      {/* Shift time */}
      <div style={{ padding: "16px 16px 12px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 4 }}>
          <span style={{ fontSize: 26, fontWeight: 700, color: K.heading, lineHeight: 1 }}>
            {shift.start}
          </span>
          <span style={{ fontSize: 16, color: K.caption, margin: "0 2px" }}>–</span>
          <span style={{ fontSize: 26, fontWeight: 700, color: K.heading, lineHeight: 1 }}>
            {shift.end}
          </span>
        </div>
        <span style={{ fontSize: 13, color: K.caption }}>
          {shift.date} &middot; {shift.hours}h scheduled
        </span>
      </div>

      {/* CTA */}
      <div style={{ padding: "0 16px 16px" }}>
        {!submitted && (shift.status as string) === "none" ? (
          <button
            type="button"
            onClick={() => { setSubmitted(true); onSubmit(); }}
            style={{
              width: "100%", minHeight: 48, background: K.primary,
              color: "#fff", border: "none", borderRadius: 12,
              fontSize: 15, fontWeight: 700, cursor: "pointer",
              transition: "background 150ms",
            }}
            onMouseDown={e => (e.currentTarget.style.background = K.primaryDark)}
            onMouseUp={e => (e.currentTarget.style.background = K.primary)}
          >
            Submit Timesheet
          </button>
        ) : (
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "12px 16px", background: K.fill, borderRadius: 12,
          }}>
            <CheckCircle2 size={18} style={{ color: K.success, flexShrink: 0 }} />
            <span style={{ fontSize: 14, color: K.body }}>
              {submitted ? "Timesheet submitted" : "Already submitted — awaiting approval"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Pay Period Summary ─────────────────────────────────────────────────────────
function PayPeriodCard({ period }: { period: typeof MOCK.payPeriod }) {
  return (
    <div style={{ ...cardStyle, padding: "14px 16px" }}>
      <div style={{
        display: "flex", justifyContent: "space-between",
        alignItems: "center", marginBottom: 10,
      }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: K.caption, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Current Pay Period
        </span>
        <span style={{ fontSize: 12, color: K.caption }}>{period.start} – {period.end}</span>
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        <div style={{
          flex: 1, background: K.fill, borderRadius: 10, padding: "10px 12px", textAlign: "center",
        }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: K.heading }}>{period.hours}h</div>
          <div style={{ fontSize: 11, color: K.caption, marginTop: 2 }}>Hours logged</div>
        </div>
        <div style={{
          flex: 1, background: K.primaryTint, borderRadius: 10, padding: "10px 12px", textAlign: "center",
        }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: K.primary }}>${period.cash.toFixed(0)}</div>
          <div style={{ fontSize: 11, color: K.primary, opacity: 0.8, marginTop: 2 }}>Cash est.</div>
        </div>
      </div>
    </div>
  );
}

// ── Notice card ────────────────────────────────────────────────────────────────
function NoticeCard({ notice }: { notice: typeof MOCK.notices[0] }) {
  return (
    <div style={{
      ...cardStyle,
      padding: "12px 16px",
      display: "flex", gap: 12, alignItems: "flex-start",
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 9999, background: K.primaryTint,
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>
        <Megaphone size={16} style={{ color: K.primary }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: K.heading, marginBottom: 2 }}>
          {notice.title}
        </div>
        <div style={{ fontSize: 13, color: K.body, lineHeight: 1.5 }}>{notice.body}</div>
        <div style={{ fontSize: 11, color: K.caption, marginTop: 4 }}>{notice.date}</div>
      </div>
    </div>
  );
}

// ── Quick Action row ───────────────────────────────────────────────────────────
function QuickActionRow({ action }: {
  action: typeof MOCK.quickActions[0];
}) {
  const Icon = action.icon;
  return (
    <button
      type="button"
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 14,
        padding: "14px 16px", background: "transparent", border: "none",
        borderBottom: `1px solid ${K.borderSubtle}`, cursor: "pointer",
        textAlign: "left",
      }}
    >
      <div style={{
        width: 40, height: 40, borderRadius: 12, flexShrink: 0,
        background: K.fill,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Icon size={20} style={{ color: K.heading }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: K.heading }}>{action.label}</div>
        <div style={{ fontSize: 12, color: K.caption, marginTop: 1 }}>{action.sub}</div>
      </div>
      <ChevronRight size={18} style={{ color: K.placeholder, flexShrink: 0 }} />
    </button>
  );
}

// ── Home Tab ───────────────────────────────────────────────────────────────────
function HomeTab() {
  const [homeSubTab, setHomeSubTab] = useState<HomeSubTab>("myDay");
  const [shiftSubmitted, setShiftSubmitted] = useState(false);
  const today = "Monday, 21 April 2026";

  return (
    <div style={{
      flex: 1, overflowY: "auto", paddingBottom: 88,
      background: K.fill,
    }}>
      {/* Greeting header */}
      <div style={{
        background: K.bg, borderBottom: `1px solid ${K.borderSubtle}`,
        padding: "20px 16px 16px",
      }}>
        <p style={{ fontSize: 13, color: K.caption, marginBottom: 4 }}>
          Good morning,
        </p>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: K.heading, margin: 0, lineHeight: 1.2 }}>
          {MOCK.name}
        </h1>
        <p style={{ fontSize: 13, color: K.caption, marginTop: 4 }}>{today}</p>
      </div>

      {/* Sub-tab row */}
      <div style={{
        background: K.bg, padding: "8px 16px 0",
        borderBottom: `1px solid ${K.borderSubtle}`,
        display: "flex", gap: 0,
      }}>
        {([
          { id: "myDay",   label: "My Day",   icon: Home },
          { id: "shopping", label: "Shopping", icon: ShoppingCart },
          { id: "storage",  label: "Storage",  icon: Package },
        ] as { id: HomeSubTab; label: string; icon: React.ElementType }[]).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setHomeSubTab(id)}
            style={{
              flex: 1, display: "flex", flexDirection: "column",
              alignItems: "center", gap: 4, padding: "8px 0 10px",
              background: "transparent", border: "none", cursor: "pointer",
              borderBottom: homeSubTab === id
                ? `2px solid ${K.primary}`
                : "2px solid transparent",
            }}
          >
            <Icon
              size={18}
              style={{ color: homeSubTab === id ? K.primary : K.caption }}
            />
            <span style={{
              fontSize: 12, fontWeight: homeSubTab === id ? 700 : 400,
              color: homeSubTab === id ? K.primary : K.caption,
            }}>
              {label}
            </span>
          </button>
        ))}
      </div>

      {/* My Day content */}
      {homeSubTab === "myDay" && (
        <div style={{ padding: "16px 16px 0", display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Today's shift */}
          <section>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <div style={{
                width: 7, height: 7, borderRadius: 9999,
                background: K.primary, animation: "pulse 2s infinite",
              }} />
              <h2 style={{
                fontSize: 11, fontWeight: 700, color: K.caption,
                textTransform: "uppercase", letterSpacing: "0.08em", margin: 0,
              }}>
                Today&rsquo;s Shift
              </h2>
            </div>
            <ShiftCard shift={MOCK.shift} onSubmit={() => setShiftSubmitted(true)} />
          </section>

          {/* Pay period */}
          <section>
            <PayPeriodCard period={MOCK.payPeriod} />
          </section>

          {/* Quick actions */}
          <section>
            <h2 style={{
              fontSize: 11, fontWeight: 700, color: K.caption,
              textTransform: "uppercase", letterSpacing: "0.08em",
              margin: "0 0 10px",
            }}>
              Quick Actions
            </h2>
            <div style={{ ...cardStyle, overflow: "hidden" }}>
              {MOCK.quickActions.filter(a => !a.ownerOnly).map((action) => (
                <QuickActionRow key={action.id} action={action} />
              ))}
            </div>
          </section>

          {/* Notices */}
          {MOCK.notices.length > 0 && (
            <section style={{ marginBottom: 8 }}>
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                marginBottom: 10,
              }}>
                <h2 style={{
                  fontSize: 11, fontWeight: 700, color: K.caption,
                  textTransform: "uppercase", letterSpacing: "0.08em", margin: 0,
                }}>
                  Notices
                </h2>
                <span style={{
                  fontSize: 11, fontWeight: 700, color: "#fff",
                  background: K.primary, borderRadius: 9999,
                  padding: "1px 7px", minWidth: 18, textAlign: "center",
                }}>
                  {MOCK.notices.length}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {MOCK.notices.map(n => <NoticeCard key={n.id} notice={n} />)}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Shopping placeholder */}
      {homeSubTab === "shopping" && (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", padding: "60px 32px", gap: 12,
        }}>
          <ShoppingCart size={40} style={{ color: K.placeholder }} />
          <p style={{ fontSize: 16, fontWeight: 600, color: K.heading, margin: 0 }}>Shopping list</p>
          <p style={{ fontSize: 14, color: K.caption, textAlign: "center", margin: 0 }}>
            Nothing on the list yet — add items for your store.
          </p>
          <button type="button" style={{
            marginTop: 8, background: K.primary, color: "#fff",
            border: "none", borderRadius: 12, fontSize: 14, fontWeight: 700,
            padding: "0 24px", height: 44, cursor: "pointer",
          }}>
            Add Item
          </button>
        </div>
      )}

      {/* Storage placeholder */}
      {homeSubTab === "storage" && (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", padding: "60px 32px", gap: 12,
        }}>
          <Package size={40} style={{ color: K.placeholder }} />
          <p style={{ fontSize: 16, fontWeight: 600, color: K.heading, margin: 0 }}>Storage inventory</p>
          <p style={{ fontSize: 14, color: K.caption, textAlign: "center", margin: 0 }}>
            No stock items recorded for your store yet.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Bottom Tab Bar ─────────────────────────────────────────────────────────────
function BottomTab({
  activeTab, onChange,
}: {
  activeTab: Tab;
  onChange: (t: Tab) => void;
}) {
  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "home",       label: "Home",      icon: Home },
    { id: "schedule",   label: "Schedule",  icon: CalendarDays },
    { id: "timesheets", label: "Timesheets",icon: Clock },
    { id: "settings",   label: "Settings",  icon: Settings },
  ];

  return (
    <div style={{
      position: "fixed", bottom: 0, left: 0, right: 0,
      maxWidth: 640, margin: "0 auto",
      background: "rgba(255,255,255,0.88)",
      backdropFilter: "blur(12px)",
      borderTop: `1px solid ${K.borderSubtle}`,
      boxShadow: "0px -1px 0px rgba(0,0,0,0.06)",
      display: "flex",
      paddingBottom: "env(safe-area-inset-bottom, 0px)",
      zIndex: 100,
    }}>
      {tabs.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          style={{
            flex: 1, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            gap: 3, height: 56, background: "transparent",
            border: "none", cursor: "pointer",
          }}
        >
          <Icon
            size={22}
            style={{ color: activeTab === id ? K.primary : K.caption }}
          />
          <span style={{
            fontSize: 10, fontWeight: activeTab === id ? 700 : 400,
            color: activeTab === id ? K.primary : K.caption,
          }}>
            {label}
          </span>
        </button>
      ))}
    </div>
  );
}

// ── Top Nav Bar ────────────────────────────────────────────────────────────────
function TopNavBar({ name }: { name: string }) {
  return (
    <div style={{
      position: "sticky", top: 0, zIndex: 50,
      background: "rgba(255,255,255,0.88)",
      backdropFilter: "blur(12px)",
      borderBottom: `1px solid ${K.borderSubtle}`,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "0 16px", height: 56,
    }}>
      <span style={{ fontSize: 17, fontWeight: 700, color: K.heading }}>
        Team Portal
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button type="button" style={{ background: "transparent", border: "none", cursor: "pointer", padding: 4 }}>
          <Bell size={22} style={{ color: K.heading }} />
        </button>
        {/* Avatar */}
        <div style={{
          width: 32, height: 32, borderRadius: 9999,
          background: K.primary,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 13, fontWeight: 700, color: "#fff",
        }}>
          {name.charAt(0).toUpperCase()}
        </div>
      </div>
    </div>
  );
}

// ── Placeholder Tab ────────────────────────────────────────────────────────────
function PlaceholderTab({ label }: { label: string }) {
  return (
    <div style={{
      flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
      color: K.caption, fontSize: 15, paddingBottom: 80,
    }}>
      {label} — coming soon
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export function PortalDashboardSample() {
  const [activeTab, setActiveTab] = useState<Tab>("home");

  return (
    <div style={{
      fontFamily: '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", Roboto, "Noto Sans KR", sans-serif',
      background: K.fill,
      minHeight: "100dvh",
      display: "flex", flexDirection: "column",
      maxWidth: 640, margin: "0 auto",
      position: "relative",
    }}>
      <TopNavBar name={MOCK.name} />

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflowY: "auto" }}>
        {activeTab === "home"       && <HomeTab />}
        {activeTab === "schedule"   && <PlaceholderTab label="Schedule" />}
        {activeTab === "timesheets" && <PlaceholderTab label="Timesheets" />}
        {activeTab === "settings"   && <PlaceholderTab label="Settings" />}
      </div>

      <BottomTab activeTab={activeTab} onChange={setActiveTab} />

      {/* Sample label banner */}
      <div style={{
        position: "fixed", top: 60, left: "50%", transform: "translateX(-50%)",
        background: K.heading, color: "#fff",
        fontSize: 11, fontWeight: 700, padding: "3px 12px", borderRadius: 9999,
        letterSpacing: "0.06em", zIndex: 200, pointerEvents: "none",
        whiteSpace: "nowrap",
      }}>
        DESIGN SAMPLE — Karrot Style
      </div>
    </div>
  );
}
