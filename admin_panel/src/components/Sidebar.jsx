import { NavLink } from 'react-router-dom';
import { LayoutDashboard, ListOrdered, MenuSquare, LogOut, Utensils, Settings, BarChart2, Send, Star, XCircle, Stars, MapPin, Moon, Sun } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { cn } from '../lib/utils';
import { motion } from 'framer-motion';

const Sidebar = () => {
  const { logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const navItems = [
    { name: 'مركز العمليات', icon: LayoutDashboard, path: '/', isLive: true },
    { name: 'الطلبات الحية', icon: ListOrdered, path: '/orders' },
    { name: 'إدارة القائمة', icon: MenuSquare, path: '/menu' },
    { name: 'بث الإشعارات', icon: Send, path: '/broadcast' },
    { name: 'إدارة التقييمات', icon: Star, path: '/reviews' },
    { name: 'إدارة الولاء', icon: Stars, path: '/loyalty' },
    { name: 'الطلبات الملغاة', icon: XCircle, path: '/cancelled-orders' },
    { name: 'المالية والتقارير', icon: BarChart2, path: '/reports' },
    { name: 'مناطق التوصيل', icon: MapPin, path: '/delivery-zones' },
    { name: 'الإعدادات', icon: Settings, path: '/settings' },
  ];

  return (
    <aside className="w-[280px] h-full flex flex-col bg-card/80 backdrop-blur-xl border-l border-border-subtle py-6 shrink-0 relative z-20 shadow-2xl">
      {/* Brand */}
      <div className="flex items-center gap-4 px-6 pb-8 border-b border-border-subtle mb-4">
        <div className="bg-primary/10 p-2.5 rounded-xl border border-primary/20 shrink-0">
          <Utensils className="text-primary w-6 h-6" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-text-main tracking-wide">المركزية</h2>
          <p className="text-xs text-text-muted">نظام المطعم الإداري</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 flex flex-col gap-2 px-4 overflow-y-auto">
        <div className="text-xs font-semibold text-text-muted mb-2 px-2">القائمة الرئيسية</div>
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) => cn(
              "group relative flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-300 overflow-hidden",
              isActive
                ? "text-white bg-primary shadow-lg shadow-primary/20"
                : "text-text-muted hover:text-white hover:bg-white/5"
            )}
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <motion.div
                    layoutId="activeTab"
                    className="absolute inset-0 bg-primary z-0"
                    initial={false}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  />
                )}
                <div className="relative z-10 flex items-center gap-3 w-full">
                  <item.icon className={cn("w-5 h-5 transition-colors", isActive ? "text-white" : "text-text-muted group-hover:text-primary")} />
                  <span className="flex-1">{item.name}</span>
                  {item.isLive && (
                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="text-[10px] font-black text-emerald-500 uppercase tracking-tighter">Live</span>
                    </div>
                  )}
                </div>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer / Theme & Logout */}
      <div className="px-4 mt-auto pt-6 border-t border-white/5 flex flex-col gap-3">
        <button
          onClick={toggleTheme}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 text-text-main font-semibold transition-all hover:bg-white/10 group"
        >
          {theme === 'dark' ? (
            <Sun className="w-5 h-5 text-amber-400" />
          ) : (
            <Moon className="w-5 h-5 text-indigo-400" />
          )}
          <span>{theme === 'dark' ? 'الوضع المضيء' : 'الوضع الليلي'}</span>
        </button>

        <button
          onClick={logout}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-danger/20 text-danger font-semibold transition-all hover:bg-danger/10 hover:border-danger hover:shadow-lg hover:shadow-danger/10 group"
        >
          <LogOut className="w-5 h-5 transition-transform group-hover:-translate-x-1" />
          <span>تسجيل الخروج</span>
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
