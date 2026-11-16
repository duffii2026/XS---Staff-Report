import React from 'react';
import { Loader2 } from 'lucide-react';

interface LoadingScreenProps {
  label?: string;
  sublabel?: string;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({
  label = 'Loading…',
  sublabel
}) => {
  return (
    <div className="fixed inset-0 z-[120] bg-slate-100/95 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="flex flex-col items-center gap-5 text-center max-w-sm">
        <div className="w-16 h-16 rounded-2xl bg-white border border-slate-200 shadow-md flex items-center justify-center">
          <Loader2 className="w-9 h-9 animate-spin text-blue-600" />
        </div>
        <div>
          <p className="text-sm font-bold text-slate-800">{label}</p>
          {sublabel && <p className="text-xs text-slate-500 mt-1">{sublabel}</p>}
        </div>
      </div>
    </div>
  );
};