'use client'

import React, { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Upload, File, CheckCircle, XCircle } from 'lucide-react'

type EntityType = 'clients' | 'workers' | 'tasks'

const UploadComponent: React.FC = () => {
  const router = useRouter()
  const [file, setFile] = useState<{
    name: string
    status: 'waiting' | 'processing' | 'done' | 'error'
    error?: string
    foundSheets?: Partial<Record<EntityType, boolean>>
  } | null>(null)
  const [dragActive, setDragActive] = useState(false)

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(e.type === 'dragenter' || e.type === 'dragover')
  }, [])

  const processFile = useCallback(async (file: File) => {
    setFile({
      name: file.name,
      status: 'processing',
      error: undefined,
      foundSheets: {},
    });

    try {
      const fileExtension = file.name.split('.').pop()?.toLowerCase();
      if (!['xlsx', 'csv'].includes(fileExtension || '')) {
        throw new Error('Only XLSX or CSV files are supported');
      }

      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });

      const sheetData: Partial<Record<EntityType, any[]>> = {};
      const foundSheets: Partial<Record<EntityType, boolean>> = {};

      const detectEntityTypeFromSheet = (name: string): EntityType | null => {
        const normalized = name.toLowerCase();
        if (normalized.includes('client')) return 'clients';
        if (normalized.includes('worker')) return 'workers';
        if (normalized.includes('task')) return 'tasks';
        return null;
      };

      for (const sheetName of workbook.SheetNames) {
        const entityType = detectEntityTypeFromSheet(sheetName);
        if (entityType && !sheetData[entityType]) {
          const worksheet = workbook.Sheets[sheetName];
          const data = XLSX.utils.sheet_to_json(worksheet);
          if (data.length > 0) {
            sheetData[entityType] = data;
            foundSheets[entityType] = true;
          }
        }
      }
      
      setFile(prev => ({ ...prev!, name: file.name, status: 'processing', foundSheets }));

      const requiredEntities: EntityType[] = ['clients', 'workers', 'tasks'];
      const missingEntities = requiredEntities.filter(e => !foundSheets[e]);

      if (missingEntities.length > 0) {
        throw new Error(`Missing or empty required sheets: ${missingEntities.join(', ')}`);
      }

      requiredEntities.forEach(entity => localStorage.removeItem(`upload:${entity}`));
      for (const entity of requiredEntities) {
        localStorage.setItem(`upload:${entity}`, JSON.stringify(sheetData[entity]));
      }

      setFile({
        name: file.name,
        status: 'done',
        foundSheets,
      });

    } catch (err) {
      const error = err as Error;
      setFile(prev => ({
        ...(prev || { name: file.name }),
        status: 'error',
        error: error.message,
        foundSheets: prev?.foundSheets || {}
      }));
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    if (e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0])
    }
  }, [processFile])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      processFile(e.target.files[0])
    }
  }

  const clearFile = () => {
    ['clients', 'workers', 'tasks'].forEach(entity => {
      localStorage.removeItem(`upload:${entity}`);
    });
    setFile(null)
  }

  const proceedToDashboard = () => {
    router.push('/dashboard')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-white border border-gray-200 shadow-sm">
        <CardHeader className="text-center space-y-1">
          <CardTitle className="text-xl font-medium text-gray-800">
            Upload Data File
          </CardTitle>
          <p className="text-gray-500 text-sm">
            Upload a single XLSX/CSV file with sheets for clients, workers, and tasks.
          </p>
        </CardHeader>

        <CardContent className="space-y-4">
          <div
            className={`
              border-2 border-dashed rounded-lg p-6 text-center transition-colors
              ${dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}
            `}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
            <p className="text-gray-700 text-sm mb-3">
              {file ? 'File ready' : 'Drag & drop file here'}
            </p>
            
            <input
              type="file"
              id="file-upload"
              accept=".csv,.xlsx"
              onChange={handleFileSelect}
              className="hidden"
            />
            <label
              htmlFor="file-upload"
              className="inline-flex items-center justify-center px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 cursor-pointer"
            >
              {file ? 'Replace File' : 'Select File'}
            </label>
          </div>

          {file?.error && (
            <Alert variant="destructive" className="bg-red-50 border-red-200">
              <XCircle className="h-4 w-4 text-red-500" />
              <AlertDescription className="text-red-700 text-sm">
                {file.error}
              </AlertDescription>
            </Alert>
          )}

          {file && (
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex items-center space-x-2">
                {file.status === 'done' ? (
                  <CheckCircle className="h-5 w-5 text-green-500" />
                ) : file.status === 'error' ? (
                  <XCircle className="h-5 w-5 text-red-500" />
                ) : (
                  <File className="h-5 w-5 text-gray-400" />
                )}
                <div>
                  <p className="text-sm font-medium text-gray-800">{file.name}</p>
                  {file.foundSheets && Object.keys(file.foundSheets).length > 0 && (
                    <p className="text-xs text-gray-500">
                      Found: {Object.keys(file.foundSheets).join(', ')}
                    </p>
                  )}
                </div>
              </div>
              <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                file.status === 'done' ? 'bg-green-100 text-green-800' :
                file.status === 'error' ? 'bg-red-100 text-red-800' :
                'bg-yellow-100 text-yellow-800'
              }`}>
                {file.status}
              </span>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1 border-gray-300 text-gray-700 hover:bg-gray-50"
              onClick={clearFile}
              disabled={!file}
            >
              Clear
            </Button>
            <Button
              className="flex-1 bg-blue-600 hover:bg-blue-700"
              onClick={proceedToDashboard}
              disabled={!file || file.status !== 'done'}
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