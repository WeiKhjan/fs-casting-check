"use client"

import type React from "react"
import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Upload,
  FileText,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Download,
  ExternalLink,
  Moon,
  Sun,
  BarChart3,
  Shield,
  Zap,
  FileCheck
} from "lucide-react"
import { useTheme } from "next-themes"
import { LoadingPopup } from "@/components/ui/loading-popup"

export default function FinancialStatementChecker() {
  const [file, setFile] = useState<File | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [htmlResult, setHtmlResult] = useState<string>("")
  const [error, setError] = useState<string>("")
  const [mounted, setMounted] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const { theme, setTheme } = useTheme()

  useEffect(() => {
    setMounted(true)
  }, [])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile && selectedFile.type === "application/pdf") {
      setFile(selectedFile)
      setError("")
      setHtmlResult("")
    } else {
      setError("Please select a valid PDF file")
      setFile(null)
    }
  }

  const handleAnalyze = async () => {
    if (!file) {
      setError("Please upload a PDF file")
      return
    }

    setIsAnalyzing(true)
    setError("")
    setHtmlResult("")

    try {
      const base64 = await fileToBase64(file)

      const response = await fetch("/api/analyze-statement", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pdfBase64: base64,
          fileName: file.name,
          outputFormat: "html",
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to analyze financial statement")
      }

      const data = await response.json()
      console.log("API Response:", {
        hasHtml: !!data.html,
        htmlLength: data.html?.length,
        debug: data.debug
      })

      // Check if we have a valid HTML dashboard (not just empty or minimal HTML)
      const hasValidDashboard = data.html &&
        data.html.length > 500 &&
        data.html.includes("kpi-grid")

      if (hasValidDashboard) {
        setHtmlResult(data.html)
      } else if (data.error) {
        setError(data.error)
        console.error("API Error:", data.error)
      } else {
        // Check if Gemini returned empty response (thinking tokens issue)
        const debugInfo = data.debug || {}
        if (debugInfo.discrepanciesFound === 0 && data.html?.length < 500) {
          setError("AI returned empty analysis. This may be due to model processing limits. Please try again.")
        } else {
          setError("Failed to generate dashboard. The AI response could not be parsed.")
        }
        console.error("Full response:", data)
      }
    } catch (err) {
      console.error("Fetch error:", err)
      setError(err instanceof Error ? err.message : "An error occurred during analysis")
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleDownload = () => {
    if (!htmlResult) return
    const blob = new Blob([htmlResult], { type: "text/html" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `casting-check-${file?.name?.replace(".pdf", "") || "report"}-${new Date().toISOString().split("T")[0]}.html`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleOpenInNewTab = () => {
    if (!htmlResult) return
    const blob = new Blob([htmlResult], { type: "text/html" })
    const url = URL.createObjectURL(blob)
    window.open(url, "_blank")
  }

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.readAsDataURL(file)
      reader.onload = () => {
        const base64String = reader.result as string
        const base64 = base64String.split(",")[1]
        resolve(base64)
      }
      reader.onerror = (error) => reject(error)
    })
  }

  const features = [
    {
      icon: BarChart3,
      title: "Vertical Casting",
      description: "Recompute every subtotal and total line by line"
    },
    {
      icon: Zap,
      title: "Horizontal Casting",
      description: "Recompute every subtotal and line by line"
    },
    {
      icon: FileCheck,
      title: "Cross Referencing",
      description: "Verify notes to accounts with financial statements"
    },
    {
      icon: Shield,
      title: "Internal Consistency",
      description: "Confirm Balance Sheet balances and reconciliations"
    }
  ]

  return (
    <div className="min-h-screen bg-background transition-colors duration-300">
      {/* Loading Popup */}
      <LoadingPopup isOpen={isAnalyzing} message="Analyzing Financial Statement..." />

      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                <FileText className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold gradient-text">FS Casting Check</h1>
                <p className="text-xs text-muted-foreground">AI-Powered Audit Tool</p>
              </div>
            </div>

            {mounted && (
              <Button
                variant="outline"
                size="icon"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                className="rounded-full"
              >
                {theme === "dark" ? (
                  <Sun className="h-5 w-5 text-yellow-500" />
                ) : (
                  <Moon className="h-5 w-5 text-slate-700" />
                )}
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Hero Section */}
        <div className="text-center mb-12">
          <h2 className="text-4xl sm:text-5xl font-bold mb-4">
            <span className="gradient-text">Financial Statement</span>
            <br />
            <span className="text-foreground">Casting Check</span>
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Upload your financial statements and let AI perform comprehensive casting and cross reference check
          </p>
        </div>

        {/* Features Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {features.map((feature, index) => (
            <Card key={index} className="bg-card/50 border-border hover:border-primary/50 transition-all duration-300 hover:shadow-lg hover:-translate-y-1">
              <CardContent className="p-4 text-center">
                <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-primary/10 flex items-center justify-center">
                  <feature.icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="font-semibold text-sm mb-1">{feature.title}</h3>
                <p className="text-xs text-muted-foreground">{feature.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Upload Section */}
        <Card className="bg-card border-border glow mb-8">
          <CardContent className="p-6 sm:p-8">
            <div className="flex flex-col items-center">
              <div className="w-full max-w-md">
                <label
                  htmlFor="pdf-upload"
                  className={`
                    relative flex flex-col items-center justify-center w-full min-h-48 py-6
                    border-2 border-dashed rounded-xl cursor-pointer
                    transition-all duration-300
                    ${file
                      ? 'border-green-500 bg-green-500/10'
                      : 'border-border hover:border-primary/50 hover:bg-accent/50'
                    }
                    ${isAnalyzing ? 'pointer-events-none opacity-50' : ''}
                  `}
                >
                  <div className="flex flex-col items-center justify-center px-4 w-full">
                    {file ? (
                      <>
                        <CheckCircle2 className="w-12 h-12 text-green-500 mb-3" />
                        <p className="text-sm font-medium text-green-500">File Selected</p>
                        <p className="text-xs text-muted-foreground mt-1 px-4 text-center break-all max-w-full">
                          {file.name}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {(file.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </>
                    ) : (
                      <>
                        <Upload className="w-12 h-12 text-muted-foreground mb-3" />
                        <p className="text-sm font-medium">Drop your PDF here</p>
                        <p className="text-xs text-muted-foreground mt-1">or click to browse</p>
                      </>
                    )}
                  </div>
                  <Input
                    id="pdf-upload"
                    type="file"
                    accept="application/pdf"
                    onChange={handleFileChange}
                    disabled={isAnalyzing}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                </label>

                <Button
                  onClick={handleAnalyze}
                  disabled={isAnalyzing || !file}
                  className="w-full mt-6 h-12 text-base font-semibold bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 transition-all duration-300"
                  size="lg"
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      Analyzing Financial Statement...
                    </>
                  ) : (
                    <>
                      <BarChart3 className="w-5 h-5 mr-2" />
                      Analyze Financial Statement
                    </>
                  )}
                </Button>

                {isAnalyzing && (
                  <div className="mt-4 text-center">
                    <p className="text-sm text-muted-foreground">
                      This may take 60-90 seconds for comprehensive analysis
                    </p>
                    <div className="mt-3 flex justify-center gap-1">
                      {[...Array(3)].map((_, i) => (
                        <div
                          key={i}
                          className="w-2 h-2 rounded-full bg-primary animate-bounce"
                          style={{ animationDelay: `${i * 0.15}s` }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Error Alert */}
        {error && (
          <Alert variant="destructive" className="mb-8">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Results Section */}
        {htmlResult && (
          <Card className="bg-card border-border overflow-hidden">
            <div className="bg-secondary/50 border-b border-border p-4 sm:p-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-green-500/20 flex items-center justify-center">
                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">Analysis Complete</h3>
                    <p className="text-sm text-muted-foreground">Comprehensive casting check and audit findings</p>
                  </div>
                </div>
                <div className="flex gap-2 w-full sm:w-auto">
                  <Button
                    variant="outline"
                    onClick={handleOpenInNewTab}
                    className="flex-1 sm:flex-none"
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Open Full Report
                  </Button>
                  <Button
                    onClick={handleDownload}
                    className="flex-1 sm:flex-none bg-gradient-to-r from-green-600 to-cyan-600 hover:from-green-700 hover:to-cyan-700"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download HTML
                  </Button>
                </div>
              </div>
            </div>
            <CardContent className="p-0">
              <iframe
                ref={iframeRef}
                srcDoc={htmlResult}
                className="w-full border-0"
                style={{ height: "800px" }}
                title="Casting Check Report"
              />
            </CardContent>
          </Card>
        )}

        {/* Footer */}
        <footer className="mt-12 text-center text-sm text-muted-foreground">
          <p>FS Casting Check v2.0 | Built for Auditors</p>
        </footer>
      </main>
    </div>
  )
}
