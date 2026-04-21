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
  Bell,
  MapPin,
} from "lucide-react";

// ── Airbnb Design Tokens ───────────────────────────────────────────────────────
const A = {
  primary:     "#ef4444",  // Rausch Red — CTAs, brand moments
  primaryDark: "#e00b41",  // Deep Rausch — pressed
  primaryFaded:"rgba(239,68,68,0.12)",
  nearBlack:   "#222222",  // Near-black — headings, dark buttons
  secondary:   "#6a6a6a",  // Secondary text, descriptions
  disabled:    "rgba(0,0,0,0.24)",
  border:      "#c1c1c1",
  surface:     "#f2f2f2",  // Circular nav bg, secondary surfaces
  bg:          "#ffffff",
  shadow:      "rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px",
  shadowHover: "rgba(0,0,0,0.08) 0px 4px 12px",
  success:     "#008489",  // Airbnb teal for success states
};

// ── Mock data ──────────────────────────────────────────────────────────────────
const MOCK = {
  name: "Puspa",
  shift: {
    store: "Sushime",
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
    { id: "daily-close", label: "Submit Daily Close", sub: "End-of-day summary for managers", icon: FileText },
    { id: "shopping",    label: "Shopping List",      sub: "View & update store shopping needs", icon: ShoppingCart },
    { id: "storage",     label: "Storage Inventory",  sub: "Check current stock levels", icon: Package },
  ],
};

type Tab = "home" | "schedule" | "timesheets" | "settings";
type HomeSubTab = "myDay" | "shopping" | "storage";

// ── 3-layer card shadow ────────────────────────────────────────────────────────
const cardStyle: React.CSSProperties = {
  background: A.bg,
  borderRadius: 20,
  boxShadow: A.shadow,
};

// ── Status badge ───────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: "pending" | "approved" | "none" }) {
  const map = {
    pending:  { bg: "#fff8f0", color: "#9b6a00", label: "Pending Approval" },
    approved: { bg: "#f0fffe", color: "#008489", label: "Approved" },
    none:     { bg: A.surface, color: A.secondary, label: "Not Submitted" },
  };
  const { bg, color, label } = map[status];
  return (
    <span style={{
      background: bg, color,
      borderRadius: 14, fontSize: 11, fontWeight: 600,
      padding: "3px 10px",
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
      {/* Header */}
      <div style={{
        padding: "16px 20px 12px",
        borderBottom: `1px solid ${A.surface}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 32, height: 32, borderRadius: "50%",
            background: A.primaryFaded,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <MapPin size={15} style={{ color: A.primary }} />
          </div>
          <span style={{ fontSize: 15, fontWeight: 600, color: A.nearBlack }}>{shift.store}</span>
        </div>
        <StatusBadge status={submitted ? "pending" : shift.status} />
      </div>

      {/* Time display */}
      <div style={{ padding: "20px 20px 8px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 6 }}>
          <span style={{ fontSize: 28, fontWeight: 700, color: A.nearBlack, letterSpacing: "-0.44px" }}>
            {shift.start}
          </span>
          <span style={{ fontSize: 18, color: A.secondary }}>–</span>
          <span style={{ fontSize: 28, fontWeight: 700, color: A.nearBlack, letterSpacing: "-0.44px" }}>
            {shift.end}
          </span>
        </div>
        <div style={{ display: "flex", gap: 16 }}>
          <span style={{ fontSize: 13, color: A.secondary }}>{shift.date}</span>
          <span style={{ fontSize: 13, color: A.secondary }}>{shift.hours}h scheduled</span>
        </div>
      </div>

      {/* CTA */}
      <div style={{ padding: "12px 20px 20px" }}>
        {!submitted && (shift.status as string) === "none" ? (
          <button
            type="button"
            onClick={() => { setSubmitted(true); onSubmit(); }}
            style={{
              width: "100%", height: 48, background: A.primary,
              color: "#fff", border: "none", borderRadius: 8,
              fontSize: 16, fontWeight: 500, cursor: "pointer",
              letterSpacing: 0,
              transition: "background 160ms",
            }}
            onMouseDown={e => (e.currentTarget.style.background = A.primaryDark)}
            onMouseUp={e => (e.currentTarget.style.background = A.primary)}
          >
            Submit Timesheet
          </button>
        ) : (
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "12px 16px", background: A.surface, borderRadius: 8,
          }}>
            <CheckCircle2 size={18} style={{ color: A.success, flexShrink: 0 }} />
            <span style={{ fontSize: 14, color: A.secondary }}>
              {submitted ? "Timesheet submitted" : "Awaiting manager approval"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Pay Period Card ────────────────────────────────────────────────────────────
function PayPeriodCard({ period }: { period: typeof MOCK.payPeriod }) {
  return (
    <div style={{ ...cardStyle, padding: "18px 20px" }}>
      <div style={{
        display: "flex", justifyContent: "space-between",
        alignItems: "center", marginBottom: 14,
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: A.secondary, textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Current Pay Period
        </span>
        <span style={{ fontSize: 13, color: A.secondary }}>{period.start} – {period.end}</span>
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        <div style={{
          flex: 1, background: A.surface, borderRadius: 14,
          padding: "14px 16px",
        }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: A.nearBlack, letterSpacing: "-0.44px" }}>
            {period.hours}h
          </div>
          <div style={{ fontSize: 12, color: A.secondary, marginTop: 3 }}>Hours logged</div>
        </div>
        <div style={{
          flex: 1, background: A.primaryFaded, borderRadius: 14,
          padding: "14px 16px",
        }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: A.primary, letterSpacing: "-0.44px" }}>
            ${period.cash.toFixed(0)}
          </div>
          <div style={{ fontSize: 12, color: A.primary, opacity: 0.75, marginTop: 3 }}>Estimated cash</div>
        </div>
      </div>
    </div>
  );
}

// ── Notice Card ────────────────────────────────────────────────────────────────
function NoticeCard({ notice }: { notice: typeof MOCK.notices[0] }) {
  return (
    <div style={{
      ...cardStyle,
      padding: "16px 20px",
      display: "flex", gap: 14, alignItems: "flex-start",
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
        background: A.primaryFaded,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Megaphone size={16} style={{ color: A.primary }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: A.nearBlack, marginBottom: 4, letterSpacing: "-0.18px" }}>
          {notice.title}
        </div>
        <div style={{ fontSize: 13, color: A.secondary, lineHeight: 1.5 }}>{notice.body}</div>
        <div style={{ fontSize: 12, color: A.disabled, marginTop: 6 }}>{notice.date}</div>
      </div>
    </div>
  );
}

// ── Quick Action Row ───────────────────────────────────────────────────────────
function QuickActionRow({ action, last }: { action: typeof MOCK.quickActions[0]; last?: boolean }) {
  const Icon = action.icon;
  return (
    <button
      type="button"
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 16,
        padding: "16px 20px", background: "transparent", border: "none",
        borderBottom: last ? "none" : `1px solid ${A.surface}`,
        cursor: "pointer", textAlign: "left",
        transition: "background 160ms",
      }}
      onMouseEnter={e => (e.currentTarget.style.background = A.surface)}
      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
    >
      <div style={{
        width: 44, height: 44, borderRadius: "50%", flexShrink: 0,
        background: A.surface,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Icon size={20} style={{ color: A.nearBlack }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 500, color: A.nearBlack }}>{action.label}</div>
        <div style={{ fontSize: 13, color: A.secondary, marginTop: 2 }}>{action.sub}</div>
      </div>
      <ChevronRight size={18} style={{ color: A.border, flexShrink: 0 }} />
    </button>
  );
}

// ── Home Tab ───────────────────────────────────────────────────────────────────
function HomeTab() {
  const [homeSubTab, setHomeSubTab] = useState<HomeSubTab>("myDay");
  const [shiftSubmitted, setShiftSubmitted] = useState(false);

  return (
    <div style={{ flex: 1, overflowY: "auto", paddingBottom: 88, background: "#f7f7f7" }}>

      {/* Greeting */}
      <div style={{ background: A.bg, padding: "20px 20px 16px", borderBottom: `1px solid ${A.surface}` }}>
        <p style={{ fontSize: 13, color: A.secondary, marginBottom: 4 }}>Good morning,</p>
        <h1 style={{
          fontSize: 26, fontWeight: 700, color: A.nearBlack,
          margin: 0, letterSpacing: "-0.44px", lineHeight: 1.2,
        }}>
          {MOCK.name}
        </h1>
        <p style={{ fontSize: 13, color: A.secondary, marginTop: 4 }}>Monday, 21 April 2026</p>
      </div>

      {/* Sub-tab row */}
      <div style={{
        background: A.bg, display: "flex",
        borderBottom: `1px solid ${A.surface}`,
        padding: "0 8px",
      }}>
        {([
          { id: "myDay",   label: "My Day",  icon: Home },
          { id: "shopping", label: "Shopping", icon: ShoppingCart },
          { id: "storage",  label: "Storage",  icon: Package },
        ] as { id: HomeSubTab; label: string; icon: React.ElementType }[]).map(({ id, label, icon: Icon }) => (
          <button
            key={id} type="button"
            onClick={() => setHomeSubTab(id)}
            style={{
              flex: 1, display: "flex", flexDirection: "column",
              alignItems: "center", gap: 5, padding: "10px 0 12px",
              background: "transparent", border: "none", cursor: "pointer",
              borderBottom: homeSubTab === id ? `2px solid ${A.nearBlack}` : "2px solid transparent",
            }}
          >
            <Icon size={18} style={{ color: homeSubTab === id ? A.nearBlack : A.secondary }} />
            <span style={{
              fontSize: 12, fontWeight: homeSubTab === id ? 600 : 400,
              color: homeSubTab === id ? A.nearBlack : A.secondary,
            }}>
              {label}
            </span>
          </button>
        ))}
      </div>

      {/* My Day */}
      {homeSubTab === "myDay" && (
        <div style={{ padding: "20px 16px 0", display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Shift section */}
          <section>
            <h2 style={{
              fontSize: 11, fontWeight: 700, color: A.secondary,
              textTransform: "uppercase", letterSpacing: "0.08em",
              margin: "0 0 10px",
            }}>
              Today&rsquo;s Shift
            </h2>
            <ShiftCard shift={MOCK.shift} onSubmit={() => setShiftSubmitted(true)} />
          </section>

          {/* Pay period */}
          <section>
            <PayPeriodCard period={MOCK.payPeriod} />
          </section>

          {/* Quick actions */}
          <section>
            <h2 style={{
              fontSize: 11, fontWeight: 700, color: A.secondary,
              textTransform: "uppercase", letterSpacing: "0.08em",
              margin: "0 0 10px",
            }}>
              Quick Actions
            </h2>
            <div style={{ ...cardStyle, overflow: "hidden" }}>
              {MOCK.quickActions.map((action, i) => (
                <QuickActionRow
                  key={action.id}
                  action={action}
                  last={i === MOCK.quickActions.length - 1}
                />
              ))}
            </div>
          </section>

          {/* Notices */}
          {MOCK.notices.length > 0 && (
            <section style={{ marginBottom: 8 }}>
              <div style={{
                display: "flex", alignItems: "center",
                justifyContent: "space-between", marginBottom: 10,
              }}>
                <h2 style={{
                  fontSize: 11, fontWeight: 700, color: A.secondary,
                  textTransform: "uppercase", letterSpacing: "0.08em", margin: 0,
                }}>
                  Notices
                </h2>
                <span style={{
                  background: A.nearBlack, color: "#fff",
                  borderRadius: 9999, fontSize: 11, fontWeight: 600,
                  padding: "2px 8px",
                }}>
                  {MOCK.notices.length}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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
          justifyContent: "center", padding: "60px 32px", gap: 16,
        }}>
          <div style={{
            width: 64, height: 64, borderRadius: "50%",
            background: A.surface,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <ShoppingCart size={28} style={{ color: A.secondary }} />
          </div>
          <p style={{ fontSize: 20, fontWeight: 600, color: A.nearBlack, margin: 0, letterSpacing: "-0.18px" }}>
            Shopping list
          </p>
          <p style={{ fontSize: 14, color: A.secondary, textAlign: "center", margin: 0 }}>
            Nothing on the list yet — add items for your store.
          </p>
          <button type="button" style={{
            marginTop: 4, background: A.primary, color: "#fff",
            border: "none", borderRadius: 8, fontSize: 16, fontWeight: 500,
            padding: "0 32px", height: 48, cursor: "pointer",
          }}>
            Add Item
          </button>
        </div>
      )}

      {/* Storage placeholder */}
      {homeSubTab === "storage" && (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", padding: "60px 32px", gap: 16,
        }}>
          <div style={{
            width: 64, height: 64, borderRadius: "50%",
            background: A.surface,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Package size={28} style={{ color: A.secondary }} />
          </div>
          <p style={{ fontSize: 20, fontWeight: 600, color: A.nearBlack, margin: 0, letterSpacing: "-0.18px" }}>
            Storage inventory
          </p>
          <p style={{ fontSize: 14, color: A.secondary, textAlign: "center", margin: 0 }}>
            No stock items recorded for your store yet.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Bottom Tab Bar ─────────────────────────────────────────────────────────────
function BottomTab({ activeTab, onChange }: { activeTab: Tab; onChange: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "home",       label: "Home",       icon: Home },
    { id: "schedule",   label: "Schedule",   icon: CalendarDays },
    { id: "timesheets", label: "Timesheets", icon: Clock },
    { id: "settings",   label: "Settings",   icon: Settings },
  ];

  return (
    <div style={{
      position: "fixed", bottom: 0, left: 0, right: 0,
      maxWidth: 640, margin: "0 auto",
      background: "rgba(255,255,255,0.92)",
      backdropFilter: "blur(12px)",
      borderTop: `1px solid ${A.surface}`,
      display: "flex",
      paddingBottom: "env(safe-area-inset-bottom, 0px)",
      zIndex: 100,
    }}>
      {tabs.map(({ id, label, icon: Icon }) => (
        <button
          key={id} type="button"
          onClick={() => onChange(id)}
          style={{
            flex: 1, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            gap: 3, height: 56, background: "transparent",
            border: "none", cursor: "pointer",
          }}
        >
          <Icon size={22} style={{ color: activeTab === id ? A.nearBlack : A.border }} />
          <span style={{
            fontSize: 10, fontWeight: activeTab === id ? 600 : 400,
            color: activeTab === id ? A.nearBlack : A.border,
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
      background: "rgba(255,255,255,0.92)",
      backdropFilter: "blur(12px)",
      borderBottom: `1px solid ${A.surface}`,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "0 20px", height: 56,
    }}>
      <span style={{ fontSize: 17, fontWeight: 700, color: A.nearBlack, letterSpacing: "-0.18px" }}>
        Team Portal
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button type="button" style={{
          width: 36, height: 36, borderRadius: "50%",
          background: A.surface, border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Bell size={18} style={{ color: A.nearBlack }} />
        </button>
        <div style={{
          width: 36, height: 36, borderRadius: "50%",
          background: A.nearBlack,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, fontWeight: 600, color: "#fff",
        }}>
          {name.charAt(0).toUpperCase()}
        </div>
      </div>
    </div>
  );
}

// ── Placeholder ────────────────────────────────────────────────────────────────
function PlaceholderTab({ label }: { label: string }) {
  return (
    <div style={{
      flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
      color: A.secondary, fontSize: 15, paddingBottom: 80,
    }}>
      {label} — coming soon
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export function PortalDashboardSampleAirbnb() {
  const [activeTab, setActiveTab] = useState<Tab>("home");

  return (
    <div style={{
      fontFamily: '"Airbnb Cereal VF", Circular, -apple-system, system-ui, Roboto, "Helvetica Neue", sans-serif',
      background: "#f7f7f7",
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

      {/* Sample label */}
      <div style={{
        position: "fixed", top: 60, left: "50%", transform: "translateX(-50%)",
        background: A.nearBlack, color: "#fff",
        fontSize: 11, fontWeight: 700, padding: "3px 12px", borderRadius: 9999,
        letterSpacing: "0.06em", zIndex: 200, pointerEvents: "none",
        whiteSpace: "nowrap",
      }}>
        DESIGN SAMPLE — Airbnb Style
      </div>
    </div>
  );
}
