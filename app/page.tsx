"use client"

import type React from "react"

import { useState, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Upload, FileText, Loader2, CheckCircle2, AlertCircle, Download, ExternalLink } from "lucide-react"

export default function FinancialStatementChecker() {
  const [file, setFile] = useState<File | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [htmlResult, setHtmlResult] = useState<string>("")
  const [error, setError] = useState<string>("")
  const iframeRef = useRef<HTMLIFrameElement>(null)

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
      // Convert file to base64
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
      setHtmlResult(data.html)
    } catch (err) {
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
        // Remove the data:application/pdf;base64, prefix
        const base64 = base64String.split(",")[1]
        resolve(base64)
      }
      reader.onerror = (error) => reject(error)
    })
  }

  return (
    <div className="min-h-screen bg-background py-12 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2 text-balance">Financial Statement Casting Check</h1>
          <p className="text-muted-foreground text-balance">
            Upload your financial statements and let AI perform comprehensive casting and cross-checking
          </p>
        </div>

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Upload Financial Statement</CardTitle>
              <CardDescription>Select a PDF file containing the financial statements to analyze</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pdf">PDF File</Label>
                <div className="flex items-center gap-4">
                  <Input
                    id="pdf"
                    type="file"
                    accept="application/pdf"
                    onChange={handleFileChange}
                    disabled={isAnalyzing}
                    className="cursor-pointer"
                  />
                  {file && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <FileText className="w-4 h-4" />
                      <span>{file.name}</span>
                    </div>
                  )}
                </div>
              </div>

              <Button onClick={handleAnalyze} disabled={isAnalyzing || !file} className="w-full" size="lg">
                {isAnalyzing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Analyze Financial Statement
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {htmlResult && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-green-600" />
                      Analysis Results
                    </CardTitle>
                    <CardDescription>Comprehensive casting check and audit findings</CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={handleOpenInNewTab}>
                      <ExternalLink className="w-4 h-4 mr-2" />
                      Open Full Report
                    </Button>
                    <Button variant="default" size="sm" onClick={handleDownload}>
                      <Download className="w-4 h-4 mr-2" />
                      Download HTML
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <iframe
                  ref={iframeRef}
                  srcDoc={htmlResult}
                  className="w-full border rounded-lg bg-white"
                  style={{ height: "700px" }}
                  title="Casting Check Report"
                />
              </CardContent>
            </Card>
          )}
        </div>

        <div className="mt-8 p-4 bg-muted rounded-lg">
          <h3 className="font-semibold mb-2">What this tool checks:</h3>
          <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
            <li>Vertical casting - Recompute every subtotal and total line by line</li>
            <li>Horizontal casting - Compare current year and prior year numbers</li>
            <li>Cross referencing - Verify notes agree with primary statements</li>
            <li>Internal consistency - Confirm Balance Sheet balances and reconciliations</li>
            <li>Exception reporting - Complete list of discrepancies and mismatches</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
