import { useState, useEffect } from 'react';
import { Building2, ChevronDown, Check } from 'lucide-react';
import api, { unwrap } from '../api/client';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

const BranchSwitcher = ({ selectedBranchId, onBranchChange }) => {
  const [branches, setBranches] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchBranches = async () => {
      try {
        const data = unwrap(await api.get('/branch'));
        const branchesList = Array.isArray(data) ? data : [];
        setBranches([{ id: 'all', name: 'كل الفروع' }, ...branchesList]);
      } catch (err) {
        console.error('Failed to fetch branches', err);
      } finally {
        setLoading(false);
      }
    };
    fetchBranches();
  }, []);

  const selectedBranch = branches.find(b => b.id === (selectedBranchId || 'all')) || branches[0];

  if (loading && branches.length === 0) return (
    <div className="w-48 h-10 bg-white/5 rounded-full animate-pulse" />
  );

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-3 bg-background border border-slate-700/50 pl-4 pr-3 py-1.5 rounded-full hover:border-primary/50 transition-all group"
      >
        <div className="w-7 h-7 bg-primary/10 rounded-full flex items-center justify-center text-primary">
          <Building2 className="w-4 h-4" />
        </div>
        <div className="text-right">
          <p className="text-[10px] font-black text-text-muted uppercase tracking-widest leading-none mb-1">الفرع الحالي</p>
          <p className="text-xs font-bold text-white leading-none">{selectedBranch?.name || 'تحميل...'}</p>
        </div>
        <ChevronDown className={cn("w-4 h-4 text-text-muted transition-transform duration-300", isOpen && "rotate-180")} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="absolute top-full left-0 mt-2 w-56 bg-[#1e293b] border border-white/10 rounded-2xl shadow-2xl overflow-hidden z-[1000]"
          >
            <div className="p-2 space-y-1">
              {branches.map((branch) => (
                <button
                  key={branch.id}
                  onClick={() => {
                    onBranchChange(branch.id === 'all' ? null : branch.id);
                    setIsOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center justify-between px-4 py-2.5 rounded-xl text-sm transition-all",
                    (selectedBranchId === branch.id || (!selectedBranchId && branch.id === 'all'))
                      ? "bg-primary/20 text-primary font-bold"
                      : "text-slate-400 hover:bg-white/5 hover:text-white"
                  )}
                >
                  <span>{branch.name}</span>
                  {(selectedBranchId === branch.id || (!selectedBranchId && branch.id === 'all')) && <Check className="w-4 h-4" />}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default BranchSwitcher;
