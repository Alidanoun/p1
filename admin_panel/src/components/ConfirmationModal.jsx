import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Trash2, HelpCircle, ShieldAlert } from 'lucide-react';

const iconMap = {
  danger: <Trash2 className="w-6 h-6 text-red-500" />,
  warning: <AlertTriangle className="w-6 h-6 text-amber-500" />,
  info: <HelpCircle className="w-6 h-6 text-blue-500" />,
  security: <ShieldAlert className="w-6 h-6 text-primary" />
};

const bgIconMap = {
  danger: 'bg-red-500/10',
  warning: 'bg-amber-500/10',
  info: 'bg-blue-500/10',
  security: 'bg-primary/10'
};

const buttonStyleMap = {
  danger: 'bg-red-600 hover:bg-red-500 text-white',
  warning: 'bg-amber-600 hover:bg-amber-500 text-white',
  info: 'bg-blue-600 hover:bg-blue-500 text-white',
  security: 'bg-primary hover:bg-primary/90 text-primary-foreground'
};

const ConfirmationModal = ({ 
  isOpen, 
  title, 
  message, 
  onConfirm, 
  onCancel, 
  confirmText = 'تأكيد', 
  cancelText = 'إلغاء', 
  type = 'warning' 
}) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Overlay */}
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            className="absolute inset-0 bg-black/70 backdrop-blur-sm" 
            onClick={onCancel} 
          />
          
          {/* Modal Panel */}
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 15 }} 
            animate={{ opacity: 1, scale: 1, y: 0 }} 
            exit={{ opacity: 0, scale: 0.95, y: 15 }} 
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="bg-slate-900/95 border border-white/10 rounded-2xl p-6 max-w-md w-full relative z-10 shadow-2xl text-right font-sans backdrop-blur-md"
            dir="rtl"
          >
            {/* Header Icon */}
            <div className={`w-12 h-12 ${bgIconMap[type]} rounded-xl flex items-center justify-center mb-4`}>
              {iconMap[type] || iconMap.warning}
            </div>

            {/* Content */}
            <h3 className="text-lg font-bold text-white mb-2">{title}</h3>
            <p className="text-slate-300 text-sm leading-relaxed mb-6">{message}</p>

            {/* Actions */}
            <div className="flex gap-3">
              <button 
                type="button" 
                onClick={onConfirm} 
                className={`flex-1 py-2.5 rounded-xl font-bold transition-all text-sm ${buttonStyleMap[type]}`}
              >
                {confirmText}
              </button>
              <button 
                type="button" 
                onClick={onCancel} 
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-bold transition-all text-sm"
              >
                {cancelText}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default ConfirmationModal;
