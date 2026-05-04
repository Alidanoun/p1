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
        "toggle-wrapper",
        checked && "toggle-checked",
        disabled && "opacity-40 cursor-not-allowed"
      )}
    >
      <div className="toggle-container">
        <div className="toggle-button">
          <div className="toggle-button-circles-container">
            {[...Array(12)].map((_, i) => (
              <div key={i} className="toggle-button-circle" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Switch;
