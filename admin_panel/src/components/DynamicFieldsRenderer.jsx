import React from 'react';

export default function DynamicFieldsRenderer({ definitions = [], values = {}, onChange, errors = {} }) {
  if (!definitions || definitions.length === 0) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {definitions.map((def) => {
        const val = values[def.key] !== undefined && values[def.key] !== null ? values[def.key] : '';
        const hasError = !!errors[def.key];
        const errorMsg = errors[def.key];

        return (
          <div key={def.id} className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">
              {def.label} {def.isRequired && <span className="text-red-500">*</span>}
            </label>

            {def.fieldType === 'TEXT' && (
              <input
                type="text"
                value={val}
                onChange={(e) => onChange(def.key, e.target.value)}
                className={`w-full border-gray-200 bg-white/50 rounded-xl p-3 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all ${
                  hasError ? 'border-red-500 ring-2 ring-red-500/10' : ''
                }`}
                placeholder={def.label}
              />
            )}

            {def.fieldType === 'NUMBER' && (
              <input
                type="number"
                value={val}
                onChange={(e) => onChange(def.key, e.target.value === '' ? '' : Number(e.target.value))}
                className={`w-full border-gray-200 bg-white/50 rounded-xl p-3 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all ${
                  hasError ? 'border-red-500 ring-2 ring-red-500/10' : ''
                }`}
                placeholder="0"
              />
            )}

            {def.fieldType === 'DATE' && (
              <input
                type="date"
                // Extract YYYY-MM-DD from Date objects or ISO strings
                value={val ? (typeof val === 'string' ? val.split('T')[0] : new Date(val).toISOString().split('T')[0]) : ''}
                onChange={(e) => onChange(def.key, e.target.value)}
                className={`w-full border-gray-200 bg-white/50 rounded-xl p-3 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all ${
                  hasError ? 'border-red-500 ring-2 ring-red-500/10' : ''
                }`}
              />
            )}

            {def.fieldType === 'BOOLEAN' && (
              <label className="flex items-center gap-3 cursor-pointer py-2">
                <input
                  type="checkbox"
                  checked={!!val}
                  onChange={(e) => onChange(def.key, e.target.checked)}
                  className="rounded-lg text-primary focus:ring-primary border-gray-300 w-5 h-5 transition-all"
                />
                <span className="text-sm text-gray-600">نعم / تفعيل</span>
              </label>
            )}

            {def.fieldType === 'SELECT' && (
              <select
                value={val}
                onChange={(e) => onChange(def.key, e.target.value)}
                className={`w-full border-gray-200 bg-white/50 rounded-xl p-3 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all ${
                  hasError ? 'border-red-500 ring-2 ring-red-500/10' : ''
                }`}
              >
                <option value="">اختر من القائمة...</option>
                {(Array.isArray(def.options) ? def.options : JSON.parse(def.options || '[]')).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            )}

            {hasError && <p className="text-xs text-red-500">{errorMsg}</p>}
          </div>
        );
      })}
    </div>
  );
}
