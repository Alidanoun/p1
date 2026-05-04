import React from 'react';
import { cn } from '../lib/utils';

const Switch = ({ checked, onChange, disabled }) => {
  const handleToggle = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled && onChange) {
      onChange(!checked);
    }
  };

  return (
    <div 
      onClick={handleToggle}
      className={cn(
        "relative inline-flex h-7 w-14 shrink-0 cursor-pointer items-center rounded-full transition-all duration-500 ease-in-out outline-none border-2",
        checked 
          ? "bg-primary/20 border-primary/40 shadow-[0_0_15px_rgba(249,115,22,0.3)]" 
          : "bg-slate-800/50 border-white/5",
        disabled && "opacity-40 cursor-not-allowed"
      )}
    >
      <span
        className={cn(
          "pointer-events-none block h-5 w-5 rounded-full shadow-lg ring-0 transition-all duration-500 ease-in-out transform",
          checked 
            ? "translate-x-7 bg-primary shadow-[0_0_10px_rgba(249,115,22,0.8)]" 
            : "translate-x-1 bg-slate-500"
        )}
      />
      
      {/* Subtle Inner Glow for Premium Feel */}
      <div className={cn(
        "absolute inset-0 rounded-full transition-opacity duration-500",
        checked ? "opacity-100" : "opacity-0"
      )} 
      style={{
        background: 'radial-gradient(circle at center, rgba(249,115,22,0.15) 0%, transparent 70%)'
      }} />
    </div>
  );
};

export default Switch;
