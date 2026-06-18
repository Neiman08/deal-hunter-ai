import React from 'react';

export default function StatCard({ title, value, sub, icon: Icon, color = 'green', trend }) {
  const colorMap = {
    green: { bg: 'bg-neon-green/8', border: 'border-neon-green/30', icon: 'text-neon-green bg-neon-green/15', value: 'text-neon-green' },
    blue: { bg: 'bg-neon-blue/8', border: 'border-neon-blue/30', icon: 'text-neon-blue bg-neon-blue/15', value: 'text-neon-blue' },
    red: { bg: 'bg-red-500/8', border: 'border-red-500/30', icon: 'text-red-400 bg-red-500/15', value: 'text-red-400' },
    orange: { bg: 'bg-orange-500/8', border: 'border-orange-500/30', icon: 'text-orange-400 bg-orange-500/15', value: 'text-orange-400' },
    purple: { bg: 'bg-purple-500/8', border: 'border-purple-500/30', icon: 'text-purple-400 bg-purple-500/15', value: 'text-purple-400' },
    yellow: { bg: 'bg-yellow-500/8', border: 'border-yellow-500/30', icon: 'text-yellow-400 bg-yellow-500/15', value: 'text-yellow-400' },
    gray: { bg: 'bg-gray-500/8', border: 'border-gray-500/30', icon: 'text-gray-400 bg-gray-500/15', value: 'text-gray-400' },
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
          <span className="text-xs text-gray-500 font-mono">{trend}</span>
        )}
      </div>

      <div className={`text-3xl font-black font-mono ${c.value} mb-1`}>
        {value}
      </div>

      <div className="text-sm font-medium text-white mb-0.5">{title}</div>

      {sub && <div className="text-xs text-gray-400">{sub}</div>}
    </div>
  );
}