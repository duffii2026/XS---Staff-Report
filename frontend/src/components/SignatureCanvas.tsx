import React, { useRef, useState, useEffect, useImperativeHandle } from 'react';
import { PenTool, CheckCircle, RotateCcw, ShieldCheck, Bookmark, Trash2, Upload, Image as ImageIcon, Sparkles } from 'lucide-react';
import { SignatureData } from '../types';
import { getSavedSignatures, saveUserSignature, deleteUserSignature } from '../services/storage';
import { SignatureImage } from './SignatureImage';

interface SignatureCanvasProps {
  signeeName: string;
  onSaveSignature: (signature: SignatureData) => void;
  existingSignature?: SignatureData;
  userId?: string;
}

export interface SignatureCanvasHandle {
  /** Capture whatever the user currently drew/selected (without a confirm button). */
  requestSignature: () => SignatureData | undefined;
}

export const SignatureCanvas = React.forwardRef<SignatureCanvasHandle, SignatureCanvasProps>(({
  signeeName,
  onSaveSignature,
  existingSignature,
  userId
}, ref) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [signatureType, setSignatureType] = useState<'handwritten' | 'uploaded' | 'digital_type' | 'saved'>('handwritten');
  const [typedName, setTypedName] = useState(signeeName);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [savedSignature, setSavedSignature] = useState<SignatureData | undefined>(existingSignature);
  const [autoSaveProfile, setAutoSaveProfile] = useState(true);
  const [userSavedSignatures, setUserSavedSignatures] = useState<SignatureData[]>([]);

  useEffect(() => {
    const list = getSavedSignatures(userId);
    setUserSavedSignatures(list);
    if (list.length > 0 && !existingSignature && !savedSignature) {
      setSignatureType('saved');
    }
  }, [userId, existingSignature, savedSignature]);

  useEffect(() => {
    if (signatureType === 'handwritten' && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.strokeStyle = '#1e3a8a';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
      }
    }
  }, [signatureType]);

  const getPoint = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    if (!canvas) return { x: clientX, y: clientY };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    setIsDrawing(true);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const pt = getPoint(e);
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const pt = getPoint(e);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    setHasDrawn(true);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    setHasDrawn(false);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      if (result) {
        setUploadedImage(result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleApplyHandwritten = (): SignatureData | undefined => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const dataUrl = canvas.toDataURL('image/png');
    const sigData: SignatureData = {
      type: 'handwritten',
      dataUrl,
      signedAt: new Date().toISOString(),
      signeeName
    };

    if (autoSaveProfile) {
      const updatedList = saveUserSignature(userId, sigData);
      setUserSavedSignatures(updatedList);
    }

    setSavedSignature(sigData);
    onSaveSignature(sigData);
    return sigData;
  };

  const handleApplyUploaded = (): SignatureData | undefined => {
    if (!uploadedImage) return undefined;
    const sigData: SignatureData = {
      type: 'uploaded',
      dataUrl: uploadedImage,
      signedAt: new Date().toISOString(),
      signeeName
    };

    if (autoSaveProfile) {
      const updatedList = saveUserSignature(userId, sigData);
      setUserSavedSignatures(updatedList);
    }

    setSavedSignature(sigData);
    onSaveSignature(sigData);
    return sigData;
  };

  const handleApplyTyped = (): SignatureData | undefined => {
    if (!typedName.trim()) return undefined;
    const dataUrl = `Verified Digital Stamp: ${typedName} [${new Date().toLocaleDateString()}]`;
    const sigData: SignatureData = {
      type: 'digital_type',
      dataUrl,
      signedAt: new Date().toISOString(),
      signeeName: typedName
    };

    if (autoSaveProfile) {
      const updatedList = saveUserSignature(userId, sigData);
      setUserSavedSignatures(updatedList);
    }

    setSavedSignature(sigData);
    onSaveSignature(sigData);
    return sigData;
  };

  const handleSelectSavedSignature = (sig: SignatureData): SignatureData => {
    const freshSig: SignatureData = {
      ...sig,
      signedAt: new Date().toISOString()
    };
    setSavedSignature(freshSig);
    onSaveSignature(freshSig);
    return freshSig;
  };

  useImperativeHandle(ref, () => ({
    requestSignature: (): SignatureData | undefined => {
      if (savedSignature) return savedSignature;
      if (signatureType === 'handwritten' && hasDrawn) return handleApplyHandwritten();
      if (signatureType === 'uploaded' && uploadedImage) return handleApplyUploaded();
      if (signatureType === 'digital_type' && typedName.trim()) return handleApplyTyped();
      return undefined;
    }
  }));

  const handleDeleteSaved = (signedAt: string) => {
    const updated = deleteUserSignature(userId, signedAt);
    setUserSavedSignatures(updated);
    if (updated.length === 0 && signatureType === 'saved') {
      setSignatureType('handwritten');
    }
  };

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 my-3">
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 shrink-0">
          <PenTool className="w-4 h-4 text-indigo-600" />
          <span className="font-semibold text-sm text-slate-800">Digital Approval Signature</span>
        </div>
        <div className="flex gap-1 bg-slate-200/80 p-0.5 rounded-lg text-xs font-medium w-full sm:w-auto overflow-x-auto thin-scrollbar shrink-0">
          {userSavedSignatures.length > 0 && (
            <button
              type="button"
              onClick={() => setSignatureType('saved')}
              className={`px-3 sm:px-2.5 py-1.5 sm:py-1 rounded-md transition-all flex items-center justify-center gap-1 whitespace-nowrap shrink-0 flex-1 sm:flex-none ${
                signatureType === 'saved' ? 'bg-indigo-600 text-white font-bold shadow-xs' : 'text-slate-700 hover:text-slate-900 font-semibold'
              }`}
            >
              <Bookmark className="w-3 h-3 text-amber-300 shrink-0" />
              <span className="sm:hidden">Saved ({userSavedSignatures.length})</span>
              <span className="hidden sm:inline">Saved Signatures ({userSavedSignatures.length})</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setSignatureType('handwritten')}
            className={`px-3 sm:px-2.5 py-1.5 sm:py-1 rounded-md transition-all whitespace-nowrap shrink-0 flex-1 sm:flex-none justify-center ${
              signatureType === 'handwritten' ? 'bg-white text-indigo-700 font-bold shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Handsign
          </button>
          <button
            type="button"
            onClick={() => setSignatureType('uploaded')}
            className={`px-3 sm:px-2.5 py-1.5 sm:py-1 rounded-md transition-all flex items-center justify-center gap-1 whitespace-nowrap shrink-0 flex-1 sm:flex-none ${
              signatureType === 'uploaded' ? 'bg-white text-indigo-700 font-bold shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Upload className="w-3 h-3 text-blue-600 shrink-0" />
            <span className="sm:hidden">Upload Sign</span>
            <span className="hidden sm:inline">Insert Digital Sign</span>
          </button>
          <button
            type="button"
            onClick={() => setSignatureType('digital_type')}
            className={`px-3 sm:px-2.5 py-1.5 sm:py-1 rounded-md transition-all whitespace-nowrap shrink-0 flex-1 sm:flex-none justify-center ${
              signatureType === 'digital_type' ? 'bg-white text-indigo-700 font-bold shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span className="sm:hidden">Stamp ID</span>
            <span className="hidden sm:inline">Digital Stamp ID</span>
          </button>
        </div>
      </div>

      {savedSignature ? (
        <div className="bg-white border border-emerald-200 rounded-lg p-3 flex items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-3">
            {(savedSignature.type === 'handwritten' || savedSignature.type === 'uploaded') && savedSignature.dataUrl && (
              <div className="w-16 h-10 bg-slate-50 border border-slate-100 rounded-md flex items-center justify-center overflow-hidden shrink-0">
                <img src={savedSignature.dataUrl} alt="Signature" className="max-h-8 max-w-full object-contain" />
              </div>
            )}
            <div>
              <div className="text-xs font-bold text-slate-900">Signed by {savedSignature.signeeName}</div>
              <div className="text-[11px] text-slate-500">
                Timestamp: {new Date(savedSignature.signedAt).toLocaleString()} ({savedSignature.type})
              </div>
              <div className="text-[10px] font-bold text-emerald-600 flex items-center gap-1 mt-0.5">
                <ShieldCheck className="w-3 h-3" /> Signature Verified
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSavedSignature(undefined)}
            className="text-xs text-indigo-600 hover:text-indigo-800 font-medium underline"
          >
            Change / Re-sign
          </button>
        </div>
      ) : (
        <div>
          {/* TAB 1: SAVED SIGNATURES */}
          {signatureType === 'saved' && userSavedSignatures.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs text-slate-600 font-medium flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" /> Select your saved signature to put it right here:
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {userSavedSignatures.map((sig, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 bg-white border border-slate-200 hover:border-indigo-400 rounded-xl flex items-center justify-between gap-2 shadow-xs group transition-all"
                  >
                    <div className="flex-1 min-w-0">
                      {sig.type === 'handwritten' || sig.type === 'uploaded' ? (
                        <div className="bg-slate-50 border border-slate-100 p-1.5 rounded-lg flex items-center justify-center">
                          <SignatureImage src={sig.dataUrl} alt="Saved Sign" className="h-9 max-w-full object-contain" fallbackText="Unavailable" />
                        </div>
                      ) : (
                        <div className="text-xs font-serif italic text-indigo-900 font-bold truncate">
                          {sig.dataUrl}
                        </div>
                      )}
                      <div className="text-[10px] text-slate-400 mt-1">
                        Saved: {new Date(sig.signedAt).toLocaleDateString()}
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleSelectSavedSignature(sig)}
                        className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-xs flex items-center gap-1"
                      >
                        <CheckCircle className="w-3.5 h-3.5" /> Put Sign
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteSaved(sig.signedAt)}
                        className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg transition-colors"
                        title="Delete saved signature"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: HANDSIGN (DRAW) */}
          {signatureType === 'handwritten' && (
            <div>
              <div className="relative border border-slate-300 bg-white rounded-lg overflow-hidden shadow-inner">
                <canvas
                  ref={canvasRef}
                  width={380}
                  height={110}
                  onMouseDown={startDrawing}
                  onMouseMove={draw}
                  onMouseUp={stopDrawing}
                  onMouseLeave={stopDrawing}
                  onTouchStart={startDrawing}
                  onTouchMove={draw}
                  onTouchEnd={stopDrawing}
                  className="w-full h-[110px] cursor-crosshair touch-none"
                />
                {!hasDrawn && (
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center text-slate-400 text-xs italic">
                    Draw your handsign here using mouse or touch pad
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center mt-2 gap-2">
                <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2">
                  <button
                    type="button"
                    onClick={clearCanvas}
                    className="text-xs text-slate-600 hover:text-slate-900 flex items-center gap-1 font-medium"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Clear Pad
                  </button>
                  <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer sm:ml-2 font-medium">
                    <input
                      type="checkbox"
                      checked={autoSaveProfile}
                      onChange={e => setAutoSaveProfile(e.target.checked)}
                      className="rounded text-indigo-600 focus:ring-indigo-500"
                    />
                    Save to My Saved Signatures for next time
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: INSERT DIGITAL SIGN (FILE UPLOAD) */}
          {signatureType === 'uploaded' && (
            <div className="bg-white border border-slate-300 rounded-lg p-3 space-y-3">
              <input
                type="file"
                ref={fileInputRef}
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
              />

              {uploadedImage ? (
                <div className="space-y-2">
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-center">
                    <img
                      src={uploadedImage}
                      alt="Uploaded Signature Preview"
                      className="max-h-24 max-w-full object-contain"
                    />
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="text-indigo-600 font-semibold hover:underline flex items-center gap-1"
                    >
                      <Upload className="w-3.5 h-3.5" /> Choose Different Image
                    </button>
                    <button
                      type="button"
                      onClick={() => setUploadedImage(null)}
                      className="text-rose-600 hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-300 hover:border-indigo-500 rounded-xl p-6 text-center cursor-pointer bg-slate-50/50 hover:bg-slate-50 transition-all group"
                >
                  <ImageIcon className="w-8 h-8 mx-auto text-slate-400 group-hover:text-indigo-600 mb-2" />
                  <p className="text-xs font-bold text-slate-700">Click to upload your digital signature image</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">Supports PNG, JPG, WEBP, or SVG files</p>
                </div>
              )}

              <div className="flex flex-wrap justify-between items-center text-xs text-slate-600 gap-2 pt-1 border-t border-slate-100">
                <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer font-medium">
                  <input
                    type="checkbox"
                    checked={autoSaveProfile}
                    onChange={e => setAutoSaveProfile(e.target.checked)}
                    className="rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  Save to My Saved Signatures for next time
                </label>
                <button
                  type="button"
                  onClick={handleApplyUploaded}
                  disabled={!uploadedImage}
                  className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold flex items-center gap-1 shadow-xs"
                >
                  <CheckCircle className="w-3.5 h-3.5" /> Attach Uploaded Signature
                </button>
              </div>
            </div>
          )}

          {/* TAB 4: DIGITAL STAMP ID */}
          {signatureType === 'digital_type' && (
            <div className="bg-white border border-slate-300 rounded-lg p-3">
              <label className="block text-xs text-slate-600 font-medium mb-1">Type Full Name for E-Stamp Signature</label>
              <input
                type="text"
                value={typedName}
                onChange={e => setTypedName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 font-serif italic mb-2 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                placeholder="Enter full legal name..."
              />
              <div className="flex flex-wrap justify-between items-center text-xs text-slate-500 gap-2">
                <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer font-medium">
                  <input
                    type="checkbox"
                    checked={autoSaveProfile}
                    onChange={e => setAutoSaveProfile(e.target.checked)}
                    className="rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  Save to My Saved Signatures for next time
                </label>
                <button
                  type="button"
                  onClick={handleApplyTyped}
                  disabled={!typedName.trim()}
                  className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold flex items-center gap-1 shadow-xs"
                >
                  <CheckCircle className="w-3.5 h-3.5" /> Apply Digital Stamp
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
});


