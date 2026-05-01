import React, { useState, useEffect, useCallback } from 'react';
import api from '../api/client';
import { 
  ShieldCheck, 
  AlertTriangle, 
  Bug, 
  Search,
  RefreshCcw,
  Clock,
  Fingerprint,
  Settings2
} from 'lucide-react';
import { io } from 'socket.io-client';
import { motion, AnimatePresence } from 'framer-motion';

const AuditLog = () => {
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState({ totalToday: 0, errorsToday: 0, criticalToday: 0, topActions: [] });
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ page: 1, limit: 20, severity: '', action: '', status: '' });
  const [selectedLog, setSelectedLog] = useState(null);
  const [isSocketConnected, setIsSocketConnected] = useState(false);

  const fetchLogs = useCallback(async () => {
    try {
      const response = await api.get('/admin/audit/logs', { params: filters });
      setLogs(response.data.data.logs);
      setLoading(false);
    } catch (err) {
      console.error('Failed to fetch logs', err);
    }
  }, [filters]);

  const fetchStats = async () => {
    try {
      const response = await api.get('/admin/audit/stats');
      setStats(response.data.data);
    } catch (err) {
      console.error('Failed to fetch stats', err);
    }
  };

  useEffect(() => {
    fetchLogs();
    fetchStats();
    
    // 📡 Real-time Listener
    const socket = io(window.location.origin, {
      auth: { token: localStorage.getItem('token') }
    });

    socket.on('connect', () => setIsSocketConnected(true));
    socket.on('audit:new_log', (newLog) => {
      setLogs(prev => [newLog, ...prev].slice(0, filters.limit));
      fetchStats(); // Update counters
    });

    return () => socket.disconnect();
  }, [fetchLogs, filters.limit]);

  const getSeverityColor = (sev) => {
    switch (sev) {
      case 'CRITICAL': return 'bg-red-500/10 text-red-500 border-red-500/20';
      case 'WARN': return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
      default: return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
    }
  };

  return (
    <div className="p-6 bg-slate-950 min-h-screen text-slate-200">
      {/* 🚀 Header Section */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
            Observability Dashboard
          </h1>
          <p className="text-slate-500 text-sm mt-1 flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${isSocketConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></span>
            {isSocketConnected ? 'System monitoring active (Real-time)' : 'Disconnected from log stream'}
          </p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => fetchLogs()} className="p-2 bg-slate-900 border border-slate-800 rounded-lg hover:bg-slate-800 transition-all">
            <RefreshCcw className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* 📊 Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {[
          { label: "Today's Events", value: stats.totalToday, icon: Clock, color: "blue" },
          { label: "Failed Operations", value: stats.errorsToday, icon: AlertTriangle, color: "amber" },
          { label: "Critical Alerts", value: stats.criticalToday, icon: Bug, color: "red" }
        ].map((stat, i) => (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            key={i} 
            className="bg-slate-900/50 backdrop-blur-xl border border-slate-800 p-6 rounded-2xl"
          >
            <div className="flex justify-between items-start">
              <div>
                <p className="text-slate-500 text-sm font-medium">{stat.label}</p>
                <h3 className="text-3xl font-bold mt-1">{stat.value}</h3>
              </div>
              <div className={`p-3 rounded-xl bg-${stat.color}-500/10 text-${stat.color}-500 border border-${stat.color}-500/20`}>
                <stat.icon className="w-6 h-6" />
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* 🔍 Filter Bar */}
      <div className="bg-slate-900/40 border border-slate-800 p-4 rounded-xl mb-6 flex flex-wrap gap-4 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input 
            type="text" 
            placeholder="Search by Action (e.g. LOGIN)..." 
            className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2 pl-10 pr-4 focus:ring-2 focus:ring-blue-500 outline-none"
            onChange={(e) => setFilters(prev => ({ ...prev, action: e.target.value, page: 1 }))}
          />
        </div>
        <select 
          className="bg-slate-950 border border-slate-800 rounded-lg py-2 px-4 outline-none"
          onChange={(e) => setFilters(prev => ({ ...prev, severity: e.target.value, page: 1 }))}
        >
          <option value="">All Severities</option>
          <option value="INFO">Info</option>
          <option value="WARN">Warning</option>
          <option value="CRITICAL">Critical</option>
        </select>
        <select 
          className="bg-slate-950 border border-slate-800 rounded-lg py-2 px-4 outline-none"
          onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value, page: 1 }))}
        >
          <option value="">All Status</option>
          <option value="SUCCESS">Success</option>
          <option value="FAIL">Fail</option>
        </select>
      </div>

      {/* 🧾 Logs Table */}
      <div className="bg-slate-900/30 border border-slate-800 rounded-2xl overflow-hidden backdrop-blur-sm">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-900/50">
              <th className="p-4 text-slate-400 font-medium text-sm">Timestamp</th>
              <th className="p-4 text-slate-400 font-medium text-sm">Action</th>
              <th className="p-4 text-slate-400 font-medium text-sm">User</th>
              <th className="p-4 text-slate-400 font-medium text-sm">Entity</th>
              <th className="p-4 text-slate-400 font-medium text-sm">Status</th>
              <th className="p-4 text-slate-400 font-medium text-sm">Severity</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr 
                key={log.id} 
                onClick={() => setSelectedLog(log)}
                className="border-b border-slate-800/50 hover:bg-slate-800/30 cursor-pointer transition-colors group"
              >
                <td className="p-4 text-sm text-slate-500 font-mono">
                  {new Date(log.createdAt).toLocaleTimeString()}
                </td>
                <td className="p-4 font-bold text-slate-200 group-hover:text-blue-400">
                  {log.action}
                </td>
                <td className="p-4 text-sm">
                  <div className="flex items-center gap-2">
                    <Fingerprint className="w-4 h-4 text-slate-600" />
                    {log.userId?.substring(0, 8) || 'System'}
                  </div>
                </td>
                <td className="p-4 text-sm text-slate-400">
                  {log.entityType ? `${log.entityType} (${log.entityId})` : '-'}
                </td>
                <td className="p-4">
                  <span className={`text-[10px] uppercase tracking-widest font-bold px-2 py-1 rounded-full ${log.status === 'SUCCESS' ? 'text-green-500 bg-green-500/10' : 'text-red-500 bg-red-500/10'}`}>
                    {log.status}
                  </span>
                </td>
                <td className="p-4">
                  <span className={`text-[10px] px-2 py-1 rounded border ${getSeverityColor(log.severity)} font-bold`}>
                    {log.severity}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 🔍 Details Slide-over */}
      <AnimatePresence>
        {selectedLog && (
          <>
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setSelectedLog(null)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
            />
            <motion.div 
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              className="fixed top-0 right-0 h-full w-full max-w-xl bg-slate-900 border-l border-slate-800 z-50 p-8 overflow-y-auto shadow-2xl"
            >
              <div className="flex justify-between items-start mb-8">
                <div>
                  <h2 className="text-2xl font-bold">{selectedLog.action}</h2>
                  <p className="text-slate-500 font-mono text-sm mt-1">{selectedLog.id}</p>
                </div>
                <button onClick={() => setSelectedLog(null)} className="text-slate-500 hover:text-white">✕</button>
              </div>

              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-slate-950 rounded-xl border border-slate-800">
                    <p className="text-xs text-slate-500 uppercase font-bold mb-1">IP Address</p>
                    <p className="font-mono text-blue-400">{selectedLog.ip || 'Local'}</p>
                  </div>
                  <div className="p-4 bg-slate-950 rounded-xl border border-slate-800">
                    <p className="text-xs text-slate-500 uppercase font-bold mb-1">Severity</p>
                    <p className="font-bold">{selectedLog.severity}</p>
                  </div>
                </div>

                <div className="p-4 bg-slate-950 rounded-xl border border-slate-800">
                  <p className="text-xs text-slate-500 uppercase font-bold mb-2">User Agent</p>
                  <p className="text-xs text-slate-400 leading-relaxed italic">{selectedLog.userAgent || 'Unknown Agent'}</p>
                </div>

                {selectedLog.metadata?.diff && (
                  <div className="space-y-4">
                    <h3 className="font-bold flex items-center gap-2">
                      <Settings2 className="w-5 h-5 text-blue-500" />
                      Data Diff (Before/After)
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-4 bg-red-500/5 border border-red-500/10 rounded-lg">
                        <p className="text-[10px] uppercase text-red-500 font-bold mb-2">Before</p>
                        <pre className="text-[10px] text-slate-400 overflow-x-auto">
                          {JSON.stringify(selectedLog.metadata.before, null, 2)}
                        </pre>
                      </div>
                      <div className="p-4 bg-green-500/5 border border-green-500/10 rounded-lg">
                        <p className="text-[10px] uppercase text-green-500 font-bold mb-2">After</p>
                        <pre className="text-[10px] text-slate-400 overflow-x-auto">
                          {JSON.stringify(selectedLog.metadata.after, null, 2)}
                        </pre>
                      </div>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <h3 className="font-bold">Full Payload</h3>
                  <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 font-mono text-[11px] text-blue-300">
                    <pre>{JSON.stringify(selectedLog.metadata, null, 2)}</pre>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AuditLog;
