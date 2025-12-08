"use client"

import Image from "next/image"

interface LoadingPopupProps {
  isOpen: boolean
  message?: string
}

export function LoadingPopup({ isOpen, message = "Analyzing Financial Statement..." }: LoadingPopupProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Popup */}
      <div className="relative z-10 bg-card border border-border rounded-2xl p-8 shadow-2xl max-w-sm w-full mx-4">
        <div className="flex flex-col items-center">
          {/* Avatar with spinning ring */}
          <div className="relative w-32 h-32 mb-6">
            {/* Spinning outer ring */}
            <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-blue-500 border-r-purple-500 animate-spin" />

            {/* Spinning inner ring (opposite direction) */}
            <div
              className="absolute inset-2 rounded-full border-4 border-transparent border-b-cyan-500 border-l-pink-500"
              style={{ animation: "spin 1.5s linear infinite reverse" }}
            />

            {/* Glowing effect */}
            <div className="absolute inset-0 rounded-full bg-gradient-to-r from-blue-500/20 via-purple-500/20 to-cyan-500/20 animate-pulse" />

            {/* Avatar image */}
            <div className="absolute inset-4 rounded-full overflow-hidden bg-card border-2 border-border">
              <Image
                src="/images/avatar.png"
                alt="AI Assistant"
                fill
                className="object-cover"
                priority
              />
            </div>
          </div>

          {/* Loading text */}
          <h3 className="text-lg font-semibold text-foreground mb-2">
            {message}
          </h3>

          <p className="text-sm text-muted-foreground text-center mb-4">
            Please wait while AI analyzes your document
          </p>

          {/* Progress dots */}
          <div className="flex gap-2">
            {[...Array(4)].map((_, i) => (
              <div
                key={i}
                className="w-3 h-3 rounded-full bg-gradient-to-r from-blue-500 to-purple-500"
                style={{
                  animation: "bounce 1s ease-in-out infinite",
                  animationDelay: `${i * 0.15}s`,
                }}
              />
            ))}
          </div>

          {/* Time estimate */}
          <p className="text-xs text-muted-foreground mt-4">
            This may take 60-90 seconds
          </p>
        </div>
      </div>

      <style jsx>{`
        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
        @keyframes bounce {
          0%, 100% {
            transform: translateY(0);
            opacity: 1;
          }
          50% {
            transform: translateY(-8px);
            opacity: 0.5;
          }
        }
      `}</style>
    </div>
  )
}
