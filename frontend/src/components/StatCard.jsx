import React from 'react';

export default function StatCard({ title, value, sub, icon: Icon, color = 'green', trend }) {
  const colorMap = {
    green: { bg: 'bg-neon-green/5', border: 'border-neon-green/20', icon: 'text-neon-green bg-neon-green/10', value: 'text-neon-green' },
    blue: { bg: 'bg-neon-blue/5', border: 'border-neon-blue/20', icon: 'text-neon-blue bg-neon-blue/10', value: 'text-neon-blue' },
    red: { bg: 'bg-red-500/5', border: 'border-red-500/20', icon: 'text-red-400 bg-red-500/10', value: 'text-red-400' },
    orange: { bg: 'bg-orange-500/5', border: 'border-orange-500/20', icon: 'text-orange-400 bg-orange-500/10', value: 'text-orange-400' },
    purple: { bg: 'bg-purple-500/5', border: 'border-purple-500/20', icon: 'text-purple-400 bg-purple-500/10', value: 'text-purple-400' },
  };

  const c = colorMap[color] || colorMap.green;

  const renderIcon = () => {
    if (!Icon) return null;

    if (React.isValidElement(Icon)) {
      return React.cloneElement(Icon, { size: 20 });
    }

    const IconComponent = Icon;
    return <IconComponent size={20} />;
  };

  return (
    <div className={`${c.bg} border ${c.border} rounded-2xl p-5 transition-all duration-300 hover:-translate-y-1`}>
      <div className="flex items-start justify-between mb-4">
        <div className={`w-11 h-11 rounded-xl ${c.icon} flex items-center justify-center`}>
          {renderIcon()}
        </div>

        {trend && (
          <span className="text-xs font-mono" style={{ color: '#CBD5E1' }}>{trend}</span>
        )}
      </div>

      <div className={`text-3xl font-black font-mono ${c.value} mb-1`}>
        {value}
      </div>

      <div className="text-sm font-medium text-white mb-0.5">{title}</div>

      {sub && <div className="text-xs" style={{ color: '#CBD5E1' }}>{sub}</div>}
    </div>
  );
}