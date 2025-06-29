'use client'

import React, { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Upload, File, CheckCircle, XCircle, AlertCircle } from 'lucide-react'

interface FileUploadState {
  filename: string
  entity: string
  status: 'waiting' | 'processing' | 'done' | 'error'
  error?: string
  sheets?: string[]
}

interface UploadedEntity {
  clients: boolean
  workers: boolean
  tasks: boolean
}

const UploadComponent: React.FC = () => {
  const router = useRouter()
  const [uploadedFile, setUploadedFile] = useState<FileUploadState | null>(null)
  const [uploadedEntities, setUploadedEntities] = useState<UploadedEntity>({
    clients: false,
    workers: false,
    tasks: false
  })
  const [dragActive, setDragActive] = useState(false)
  const [missingSheets, setMissingSheets] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const normalizeSheetName = (name: string): string => {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '')
  }

  const matchSheetToEntity = (sheetName: string): string | null => {
    const normalized = normalizeSheetName(sheetName)
    
    if (normalized.includes('client')) return 'clients'
    if (normalized.includes('worker')) return 'workers'
    if (normalized.includes('task')) return 'tasks'
    
    return null
  }

  const parseCSV = (content: string): { data: any[]; headers: string[] } => {
    const lines = content.split('\n').filter(line => line.trim())
    if (lines.length < 1) return { data: [], headers: [] }

    // Regex to split CSV line by comma, but not if comma is inside double quotes
    const csvSplitRegex = /,(?=(?:(?:[^"]*"){2})*[^"]*$)/;

    const headers = lines[0].split(csvSplitRegex).map(h => h.trim().replace(/^"|"$/g, ''))
    const data = lines.slice(1).map(line => {
      const values = line.split(csvSplitRegex).map(v => v.trim().replace(/^"|"$/g, ''))
      const obj: any = {}
      headers.forEach((header, index) => {
        obj[header] = values[index] || ''
      })
      return obj
    })

    return { data, headers }
  }

  const processFile = async (file: File): Promise<void> => {
    
    setUploadedFile({
      filename: file.name,
      entity: '',
      status: 'processing'
    })
    setError(null)
    setMissingSheets([])

    try {
      const fileExtension = file.name.split('.').pop()?.toLowerCase()
      
      if (!['csv', 'xlsx'].includes(fileExtension || '')) {
        throw new Error('Only CSV and XLSX files are supported')
      }

      if (fileExtension === 'csv') {
        const content = await file.text()
        const { data, headers } = parseCSV(content)
        
        if (data.length === 0) {
          throw new Error('CSV file is empty or invalid')
        }

        let entityType: string | null = null
        const normalizedHeaders = headers.map(h => normalizeSheetName(h))

        const clientKeywords = ['client', 'customer', 'account', 'company']
        const workerKeywords = ['worker', 'employee', 'staff', 'personnel', 'agent']
        const taskKeywords = ['task', 'project', 'activity', 'job', 'assignment']

        const hasClientHeaders = clientKeywords.some(keyword =>
          normalizedHeaders.some(h => h.includes(keyword))
        )
        const hasWorkerHeaders = workerKeywords.some(keyword =>
          normalizedHeaders.some(h => h.includes(keyword))
        )
        const hasTaskHeaders = taskKeywords.some(keyword =>
          normalizedHeaders.some(h => h.includes(keyword))
        )

        if (hasClientHeaders) {
          entityType = 'clients'
        } else if (hasWorkerHeaders) {
          entityType = 'workers'
        } else if (hasTaskHeaders) {
          entityType = 'tasks'
        }

        if (!entityType) {
          throw new Error('Could not determine entity type from CSV headers. Please ensure headers contain keywords like "client", "worker", or "task".')
        }

        if (uploadedEntities[entityType as keyof UploadedEntity]) {
          throw new Error(`Entity type "${entityType}" already uploaded.`)
        }

        localStorage.setItem(`upload:${entityType}`, JSON.stringify(data))
        
        setUploadedFile({
          filename: file.name,
          entity: entityType,
          status: 'done'
        })

        setUploadedEntities(prev => ({
          ...prev,
          [entityType as keyof UploadedEntity]: true
        }))

      } else if (fileExtension === 'xlsx') {
        const arrayBuffer = await file.arrayBuffer()
        const workbook = XLSX.read(arrayBuffer, { type: 'array' })
        
        const sheetNames = workbook.SheetNames
        const foundEntities: { [key: string]: any[] } = {}
        const foundSheets: string[] = []
        
        for (const sheetName of sheetNames) {
          const entity = matchSheetToEntity(sheetName)
          if (entity) {
            const worksheet = workbook.Sheets[sheetName]
            const jsonData = XLSX.utils.sheet_to_json(worksheet)
            foundEntities[entity] = jsonData
            foundSheets.push(`${sheetName} → ${entity}`)
            localStorage.setItem(`upload:${entity}`, JSON.stringify(jsonData))
          }
        }

        const requiredEntities = ['clients', 'workers', 'tasks']
        const missing = requiredEntities.filter(entity => !foundEntities[entity])
        
        if (missing.length > 0) {
          setMissingSheets(missing)
          throw new Error(`Missing required sheets: ${missing.join(', ')}`)
        }

        setUploadedFile({
          filename: file.name,
          entity: 'All entities',
          status: 'done',
          sheets: foundSheets
        })

        setUploadedEntities({
          clients: true,
          workers: true,
          tasks: true
        })
      }

    } catch (err) {
      const error = err as Error
      console.error('File processing error:', error)
      setError(error.message)
      setUploadedFile({
        filename: file.name,
        entity: '',
        status: 'error',
        error: error.message
      })
    }
  }

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    const files = e.dataTransfer.files
    if (files.length > 0) {
      processFile(files[0])
    }
  }, [])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0) {
      processFile(files[0])
    }
    e.target.value = ''
  }

  const clearLocalStorage = () => {
    ['clients', 'workers', 'tasks'].forEach(entity => {
      localStorage.removeItem(`upload:${entity}`)
    })
    setUploadedEntities({
      clients: false,
      workers: false,
      tasks: false
    })
    setUploadedFile(null)
    setError(null)
  }

  const allEntitiesUploaded = uploadedEntities.clients && uploadedEntities.workers && uploadedEntities.tasks

  const handleProceed = () => {
    if (allEntitiesUploaded) {
      router.push('/dashboard')
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'done': return <CheckCircle className="w-5 h-5 text-green-500" />
      case 'error': return <XCircle className="w-5 h-5 text-red-500" />
      case 'processing': return <AlertCircle className="w-5 h-5 text-yellow-500 animate-pulse" />
      default: return <File className="w-5 h-5 text-gray-400" />
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <Card className="w-full max-w-md bg-white border-gray-200 shadow-sm">
        <CardHeader className="text-center space-y-2">
          <CardTitle className="text-2xl font-medium text-gray-900">
            Upload Data File
          </CardTitle>
          <p className="text-gray-500 text-sm">
            Upload a single CSV or XLSX file containing your data
          </p>
        </CardHeader>
        
        <CardContent className="space-y-4">
          <div
            className={`
              border-2 border-dashed rounded-lg p-8 text-center transition-all duration-200
              ${dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}
            `}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-700 mb-1">
              Drag and drop file here
            </p>
            <p className="text-gray-500 text-sm mb-3">
              or
            </p>
            
            <input
              type="file"
              accept=".csv,.xlsx"
              onChange={handleFileSelect}
              className="hidden"
              id="file-upload"
            />
            <Button
              variant="outline"
              className="border-gray-300 text-gray-700 hover:bg-gray-50"
              onClick={() => document.getElementById('file-upload')?.click()}
            >
              Select File
            </Button>
            <p className="text-gray-400 text-xs mt-3">
              Supports .csv and .xlsx files (max 5MB)
            </p>
          </div>

          {(error || missingSheets.length > 0) && (
            <Alert variant="destructive" className="bg-red-50 border-red-200">
              <XCircle className="h-4 w-4 text-red-500" />
              <AlertDescription className="text-red-700">
                {error || `Missing required sheets: ${missingSheets.join(', ')}`}
              </AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-3 gap-3">
            {(['clients', 'workers', 'tasks'] as const).map((entity) => (
              <div
                key={entity}
                className={`
                  p-3 rounded-lg border text-center transition-all
                  ${uploadedEntities[entity]
                    ? 'bg-green-50 border-green-200 text-green-700'
                    : 'bg-gray-50 border-gray-200 text-gray-500'
                  }
                `}
              >
                <div className="flex items-center justify-center mb-1">
                  {uploadedEntities[entity] ? (
                    <CheckCircle className="w-4 h-4" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border-2 border-current" />
                  )}
                </div>
                <span className="text-sm font-medium capitalize">{entity}</span>
              </div>
            ))}
          </div>

          {uploadedFile && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-gray-700">Uploaded File</h3>
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-center space-x-3">
                  {getStatusIcon(uploadedFile.status)}
                  <div>
                    <p className="text-gray-900 font-medium">{uploadedFile.filename}</p>
                    {uploadedFile.entity && (
                      <p className="text-gray-500 text-sm">Contains: {uploadedFile.entity}</p>
                    )}
                    {uploadedFile.error && (
                      <p className="text-red-500 text-sm">{uploadedFile.error}</p>
                    )}
                  </div>
                </div>
                <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                  uploadedFile.status === 'done' ? 'bg-green-100 text-green-800' :
                  uploadedFile.status === 'error' ? 'bg-red-100 text-red-800' :
                  'bg-yellow-100 text-yellow-800'
                }`}>
                  {uploadedFile.status}
                </span>
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Button
              onClick={clearLocalStorage}
              variant="outline"
              className="flex-1 border-gray-300 text-gray-700 hover:bg-gray-50"
              disabled={!uploadedFile}
            >
              Clear
            </Button>
            <Button
              onClick={handleProceed}
              className="flex-1 bg-blue-600 hover:bg-blue-700"
              disabled={!allEntitiesUploaded}
            >
              Proceed
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default UploadComponent