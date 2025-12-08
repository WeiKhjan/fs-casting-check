"use client"

import type React from "react"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Upload, FileText, Loader2, CheckCircle2, AlertCircle } from "lucide-react"

export default function FinancialStatementChecker() {
  const [file, setFile] = useState<File | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [result, setResult] = useState<string>("")
  const [error, setError] = useState<string>("")

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile && selectedFile.type === "application/pdf") {
      setFile(selectedFile)
      setError("")
      setResult("")
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
    setResult("")

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
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to analyze financial statement")
      }

      const data = await response.json()
      setResult(data.analysis)
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred during analysis")
    } finally {
      setIsAnalyzing(false)
    }
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

          {result && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                  Analysis Results
                </CardTitle>
                <CardDescription>Comprehensive casting check and audit findings</CardDescription>
              </CardHeader>
              <CardContent>
                <Textarea value={result} readOnly className="min-h-[500px] font-mono text-sm" />
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
