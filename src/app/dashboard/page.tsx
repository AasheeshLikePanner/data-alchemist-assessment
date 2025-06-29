'use client'

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { useRouter } from 'next/navigation'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { Upload, Download, Filter, Search, AlertCircle } from 'lucide-react'
import { detectEntityType, EntityType } from '@/lib/utils'
import axios from 'axios'
import { Progress } from '@/components/ui/progress'
import { toast } from 'sonner'
type ValidationLevel = 'error' | 'warning' | 'info'

interface ValidationError {
  id: string;
  entity: EntityType
  rowIndex: number
  field: string
  message: string
  level: ValidationLevel
  fixed?: boolean
}

interface Rule {
  id: string
  type: 'coRun' | 'slotRestriction' | 'loadLimit' | 'phaseWindow' | 'patternMatch' | 'precedenceOverride'
  tasks?: string[]
  clientGroup?: string
  workerGroup?: string
  minCommonSlots?: number
  maxSlotsPerPhase?: number
  allowedPhases?: number[]
  pattern?: string
  parameters?: any
  priority?: number
  active: boolean
}

interface SheetData {
  name: string
  headers: string[]
  jsonData: any[]
}

interface AiFix {
  entity: EntityType;
  rowIndex: number;
  field: string;
  newValue: any;
}

interface AiFixResponse {
  fixes: AiFix[];
}

const REQUIRED_COLUMNS: Record<EntityType, string[]> = {
  clients: ['id', 'priorityLevel'],
  workers: ['id', 'availableSlots', 'maxLoadPerPhase'],
  tasks: ['id', 'duration', 'requiredSkills'],
};

const Dashboard = () => {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<EntityType>('clients')
  const [sheets, setSheets] = useState<Record<EntityType, SheetData>>({
    clients: { name: 'Clients', headers: [], jsonData: [] },
    workers: { name: 'Workers', headers: [], jsonData: [] },
    tasks: { name: 'Tasks', headers: [], jsonData: [] }
  })
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [showFixed, setShowFixed] = useState(false)
  const [rules, setRules] = useState<Rule[]>([])
  const [activeRuleType, setActiveRuleType] = useState<Rule['type']>('coRun')
  const [newRule, setNewRule] = useState<Partial<Rule>>({ type: 'coRun', active: true, tasks: [] })
  const [editMode, setEditMode] = useState<{ [key: string]: any }>({})
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true);
  const [validationProgress, setValidationProgress] = useState(0);
  const [isFixingWithAI, setIsFixingWithAI] = useState(false);

  const normalizeFieldName = (name: string): string => {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '')
  }

  const getNormalizedValue = (row: any, fieldVariations: string[]): any => {
    for (const field of fieldVariations) {
      const normalizedField = normalizeFieldName(field)
      for (const key in row) {
        if (normalizeFieldName(key) === normalizedField) {
          return row[key]
        }
      }
    }
    return undefined
  }

  const parseArrayString = (value: any): { result: string[], error: string | null } => {
    if (Array.isArray(value)) return { result: value.map(String), error: null };
    if (typeof value !== 'string' || value.trim() === '') return { result: [], error: null };

    const trimmed = value.trim();

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return { result: parsed.map(String), error: null };
        } else {
          return { result: [], error: 'Invalid array format.' };
        }
      } catch (e) {
        return { result: [], error: 'Malformed JSON array.' };
      }
    }

    return { result: trimmed.replace(/\n/g, ',').split(',').map(s => s.trim()).filter(Boolean), error: null };
  }

  const parseJsonString = (value: any): { result: object | null, error: string | null } => {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return { result: value, error: null };
    if (typeof value !== 'string' || value.trim() === '') return { result: null, error: null };

    const trimmed = value.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
      return { result: null, error: 'Value must be a valid JSON object (e.g., {"key":"value"}).' };
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'object' && !Array.isArray(parsed) && parsed !== null) {
        return { result: parsed, error: null };
      } else {
        return { result: null, error: 'Value is not a valid JSON object.' };
      }
    } catch (e) {
      return { result: null, error: 'Malformed JSON object.' };
    }
  }

  const parsePhaseString = (value: any): { result: number[], error: string | null } => {
    if (Array.isArray(value)) return { result: value.map(Number).filter(n => !isNaN(n)), error: null };
    if (typeof value !== 'string' || value.trim() === '') return { result: [], error: null };

    const trimmed = value.trim();
    const phases: number[] = [];
    let error: string | null = null;

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          parsed.forEach(item => {
            const num = Number(item);
            if (!isNaN(num)) phases.push(num);
            else error = 'Contains non-numeric values.';
          });
        } else {
          error = 'Invalid array format.';
        }
      } catch (e) {
        error = 'Malformed JSON array.';
      }
    } else if (trimmed.includes('-')) {
      const parts = trimmed.split('-').map(s => s.trim());
      if (parts.length === 2) {
        const start = Number(parts[0]);
        const end = Number(parts[1]);
        if (!isNaN(start) && !isNaN(end) && start <= end) {
          for (let i = start; i <= end; i++) {
            phases.push(i);
          }
        } else {
          error = 'Invalid range format (e.g., "1-5").';
        }
      } else {
        error = 'Invalid range format (e.g., "1-5").';
      }
    } else {
      trimmed.split(',').forEach(item => {
        const num = Number(item.trim());
        if (!isNaN(num) && item.trim() !== '') phases.push(num);
        else if (item.trim() !== '') error = 'Contains non-numeric values or invalid format.';
      });
    }

    if (error) return { result: [], error };
    return { result: phases, error: null };
  };

  const validateRow = useCallback((entity: EntityType, row: any, rowIndex: number, allSheets: Record<EntityType, SheetData>): ValidationError[] => {
    const errors: ValidationError[] = [];
    const createError = (field: string, message: string, level: ValidationLevel = 'error') => ({
      id: `${entity}-${rowIndex}-${field}-${message}`,
      entity, rowIndex, field, message, level
    });

    Object.keys(row).forEach(key => {
      if (normalizeFieldName(key).includes('json')) {
        const { error } = parseJsonString(row[key]);
        if (error) {
          errors.push(createError(key, error));
        }
      }
    });

    if (entity === 'clients') {
      const priority = getNormalizedValue(row, ['priorityLevel', 'priority']);
      if (priority !== undefined && (Number(priority) < 1 || Number(priority) > 5)) {
        errors.push(createError('priorityLevel', 'Priority must be 1-5.'));
      }
      const { result: requestedTasks, error: taskError } = parseArrayString(getNormalizedValue(row, ['requestedTasks', 'requestedTaskIDs']));
      if (taskError) errors.push(createError('requestedTasks', taskError));
      else {
        requestedTasks.forEach((taskId: string) => {
          if (!allSheets.tasks.jsonData.some((t: any) => String(getNormalizedValue(t, ['id', 'taskId'])) === String(taskId))) {
            errors.push(createError('requestedTasks', `Task ID "${taskId}" not found.`));
          }
        });
      }
    } else if (entity === 'workers') {
      const { result: availableSlots, error: slotError } = parseArrayString(getNormalizedValue(row, ['availableSlots', 'slots']));
      if (slotError) errors.push(createError('availableSlots', slotError));
      else if (availableSlots.some(s => isNaN(Number(s)))) {
        errors.push(createError('availableSlots', 'Must be a list of numbers.'));
      }

      const maxLoad = getNormalizedValue(row, ['maxLoad', 'maxLoadPerPhase']);
      if (maxLoad !== undefined && Number(maxLoad) > availableSlots.length) {
        errors.push(createError('maxLoadPerPhase', `MaxLoad (${maxLoad}) > available slots (${availableSlots.length}).`));
      }

      const { error: skillError } = parseArrayString(getNormalizedValue(row, ['skills', 'workerSkills']));
      if (skillError) errors.push(createError('skills', skillError));

    } else if (entity === 'tasks') {
      const priority = getNormalizedValue(row, ['priority', 'priorityLevel']);
      if (priority !== undefined && (Number(priority) < 1 || Number(priority) > 5)) {
        errors.push(createError('priority', 'Priority must be 1-5.'));
      }
      const duration = getNormalizedValue(row, ['duration', 'taskDuration']);
      if (duration !== undefined && Number(duration) < 1) {
        errors.push(createError('duration', 'Duration must be >= 1.'));
      }
      const { result: preferredPhases, error: phaseError } = parsePhaseString(getNormalizedValue(row, ['preferredPhases', 'phases']));
      if (phaseError) errors.push(createError('preferredPhases', phaseError));
      else if (preferredPhases.some(p => p < 1)) {
        errors.push(createError('preferredPhases', 'Phases must be positive integers.'));
      }
      const maxConcurrent = getNormalizedValue(row, ['maxConcurrent', 'maxConcurrentTasks']);
      if (maxConcurrent) {
        const { result: requiredSkills, error: skillError } = parseArrayString(getNormalizedValue(row, ['skills', 'requiredSkills']));
        if (skillError) errors.push(createError('skills', skillError));
        else {
          const qualifiedAndAvailableWorkers = allSheets.workers.jsonData.filter(w => {
            const { result: workerSkills } = parseArrayString(getNormalizedValue(w, ['skills', 'workerSkills']));
            const { result: availableSlots } = parseArrayString(getNormalizedValue(w, ['availableSlots', 'slots']));
            return requiredSkills.every((s: string) => workerSkills.includes(s)) && availableSlots.length > 0;
          }).length;
          if (Number(maxConcurrent) > qualifiedAndAvailableWorkers) {
            errors.push(createError('maxConcurrent', `MaxConcurrent (${maxConcurrent}) > qualified, available workers (${qualifiedAndAvailableWorkers}).`));
          }
        }
      }
    }
    return errors;
  }, []);

  const validateAllData = useCallback(async (currentSheets: Record<EntityType, SheetData>) => {
    setValidationProgress(0); 
    const totalValidationSteps = 6;
    let completedSteps = 0;
    const allErrors: ValidationError[] = [];
    const createError = (entity: EntityType, rowIndex: number, field: string, message: string, level: ValidationLevel = 'error') => ({
      id: `${entity}-${rowIndex}-${field}-${message}`,
      entity, rowIndex, field, message, level
    });

    (Object.keys(currentSheets) as EntityType[]).forEach(entity => {
      if (currentSheets[entity].jsonData.length > 0) {
        const headers = currentSheets[entity].headers.map(normalizeFieldName);
        const required = REQUIRED_COLUMNS[entity] || [];
        const missing = required.filter(col => !headers.includes(normalizeFieldName(col)));
        if (missing.length > 0) {
          allErrors.push(createError(entity, -1, 'File', `Missing required columns: ${missing.join(', ')}`));
        }
      }
    });
    completedSteps++;
    setValidationProgress(Math.round((completedSteps / totalValidationSteps) * 100));

    (Object.keys(currentSheets) as EntityType[]).forEach(entity => {
      const ids = new Map<string, number>();
      currentSheets[entity].jsonData.forEach((row: any, index: number) => {
        const id = getNormalizedValue(row, ['id', `${entity.slice(0, -1)}Id`, `${entity.slice(0, -1)}ID`, `${entity.slice(0, -1)}_id`]);
        if (id !== undefined && id !== null && String(id).trim() !== '') {
          if (ids.has(String(id))) {
            allErrors.push(createError(entity, index, 'id', `Duplicate ID "${id}" also found at row ${ids.get(String(id))! + 1}`));
          } else {
            ids.set(String(id), index);
          }
        }
      });
    });
    completedSteps++;
    setValidationProgress(Math.round((completedSteps / totalValidationSteps) * 100));

    (Object.keys(currentSheets) as EntityType[]).forEach(entity => {
      currentSheets[entity].jsonData.forEach((row, rowIndex) => {
        allErrors.push(...validateRow(entity, row, rowIndex, currentSheets));
      });
    });
    completedSteps++;
    setValidationProgress(Math.round((completedSteps / totalValidationSteps) * 100));

    const phaseSlots: Record<number, number> = {};
    currentSheets.workers.jsonData.forEach((worker: any) => {
      const { result: slots } = parseArrayString(getNormalizedValue(worker, ['availableSlots', 'slots']));
      slots.forEach((slot: any) => {
        const slotNum = Number(slot);
        if (!isNaN(slotNum)) {
          phaseSlots[slotNum] = (phaseSlots[slotNum] || 0) + 1;
        }
      });
    });
    completedSteps++;
    setValidationProgress(Math.round((completedSteps / totalValidationSteps) * 100));

    const phaseRequirements: Record<number, number> = {};
    currentSheets.tasks.jsonData.forEach((task: any) => {
      const duration = getNormalizedValue(task, ['duration', 'taskDuration']) || 1;
      const phase = getNormalizedValue(task, ['phase', 'taskPhase']);
      if (phase !== undefined) {
        phaseRequirements[phase] = (phaseRequirements[phase] || 0) + Number(duration);
      }
    });

    Object.entries(phaseRequirements).forEach(([phase, required]) => {
      const available = phaseSlots[Number(phase)] || 0;
      if (required > available) {
        allErrors.push(createError('tasks', -1, 'Phase Saturation', `Phase ${phase} overloaded: requires ${required} slots, but only ${available} are available.`));
      }
    });
    completedSteps++;
    setValidationProgress(Math.round((completedSteps / totalValidationSteps) * 100));

    const allRequiredSkills = new Set(currentSheets.tasks.jsonData.flatMap(t => parseArrayString(getNormalizedValue(t, ['skills', 'requiredSkills'])).result));
    const allWorkerSkills = new Set(currentSheets.workers.jsonData.flatMap(w => parseArrayString(getNormalizedValue(w, ['skills', 'workerSkills'])).result));
    allRequiredSkills.forEach(skill => {
      if (!allWorkerSkills.has(skill)) {
        allErrors.push(createError('tasks', -1, 'Skill Coverage', `Skill "${skill}" is required by tasks but not provided by any worker.`, 'warning'));
      }
    });

    rules.filter(r => r.type === 'coRun' && r.active && r.tasks && r.tasks.length > 1).forEach(rule => {
      const graph = new Map<string, string[]>();
      rule.tasks!.forEach(taskId => {
        const task = currentSheets.tasks.jsonData.find(t => String(getNormalizedValue(t, ['id', 'taskId'])) === String(taskId));
        if (task) {
          const { result: deps } = parseArrayString(getNormalizedValue(task, ['dependencies', 'dependsOn']));
          const filteredDeps = deps.filter((d: string) => rule.tasks!.includes(d));
          graph.set(taskId, filteredDeps);
        }
      });

      const visited = new Set<string>();
      const recursionStack = new Set<string>();

      function detectCycle(taskId: string): boolean {
        visited.add(taskId);
        recursionStack.add(taskId);
        const dependencies = graph.get(taskId) || [];

        for (const depId of dependencies) {
          if (!visited.has(depId)) {
            if (detectCycle(depId)) return true;
          } else if (recursionStack.has(depId)) {
            return true;
          }
        }
        recursionStack.delete(taskId);
        return false;
      }

      for (const taskId of rule.tasks!) {
        if (!visited.has(taskId)) {
          if (detectCycle(taskId)) {
            allErrors.push(createError('tasks', -1, 'Rules', `Circular dependency in co-run rule: ${rule.tasks!.join(', ')}`));
            break;
          }
        }
      }
    });

    rules.filter(r => r.type === 'slotRestriction' && r.active).forEach(rule => {
      if (rule.clientGroup) {
        const clientExists = currentSheets.clients.jsonData.some(client =>
          String(getNormalizedValue(client, ['groupTag', 'clientGroup'])) === String(rule.clientGroup)
        );
        if (!clientExists) {
          allErrors.push(createError('clients', -1, 'Rules', `Slot Restriction rule references non-existent client group: ${rule.clientGroup}.`, 'warning'));
        }
      }
      if (rule.workerGroup) {
        const workerExists = currentSheets.workers.jsonData.some(worker =>
          String(getNormalizedValue(worker, ['workerGroup', 'groupTag'])) === String(rule.workerGroup)
        );
        if (!workerExists) {
          allErrors.push(createError('workers', -1, 'Rules', `Slot Restriction rule references non-existent worker group: ${rule.workerGroup}.`, 'warning'));
        }
      }
    });
    completedSteps++;
    setValidationProgress(Math.round((completedSteps / totalValidationSteps) * 100));

    setValidationErrors(allErrors);
    setValidationProgress(100); 
  }, [rules, validateRow]);

  useEffect(() => {
    if (!isLoading) {
      const runValidation = async () => {
        await validateAllData(sheets);
      };
      runValidation();
    }
  }, [isLoading, sheets, rules, validateAllData]);

  const markAsFixed = (errorId: string) => {
    setValidationErrors(prev => prev.map(err => err.id === errorId ? { ...err, fixed: true } : err));
  }

  useEffect(() => {
    const loadData = () => {
      try {
        const newSheets: any = {
          clients: { name: 'Clients', headers: [], jsonData: [] },
          workers: { name: 'Workers', headers: [], jsonData: [] },
          tasks: { name: 'Tasks', headers: [], jsonData: [] }
        };
        ['clients', 'workers', 'tasks'].forEach((entity: any) => {
          const storedData = localStorage.getItem(`upload:${entity}`)
          if (storedData) {
            try {
              const jsonData = JSON.parse(storedData)
              if (jsonData.length > 0) {
                const headers = Object.keys(jsonData[0]);
                newSheets[entity] = { name: entity.charAt(0).toUpperCase() + entity.slice(1), headers, jsonData };
              }
            } catch (e) {
              console.error(`Error processing ${entity}:`, e)
              setError(`Failed to parse ${entity} data`)
            }
          }
        });
        setSheets(newSheets);
      } catch (error) {
        console.error('Error loading data:', error)
        setError('Failed to load data from storage')
      } finally {
        setIsLoading(false);
      }
    }
    loadData()
  }, [])

  const handleCellEdit = (entity: EntityType, rowIndex: number, header: string, value: string) => {
    const newSheets = structuredClone(sheets);
    const item = newSheets[entity].jsonData[rowIndex];
    const keyToUpdate = Object.keys(item).find(k => normalizeFieldName(k) === normalizeFieldName(header)) || header;
    item[keyToUpdate] = value;

    localStorage.setItem(`upload:${entity}`, JSON.stringify(newSheets[entity].jsonData));

    setSheets(newSheets);
    validateAllData(newSheets);
    setEditMode({});
  };

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>, entity: EntityType) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const data = event.target?.result
        if (!data) return
        const workbook = XLSX.read(data, { type: 'binary' })
        const sheetName = workbook.SheetNames[0]
        const worksheet = workbook.Sheets[sheetName]
        const jsonData: any = XLSX.utils.sheet_to_json(worksheet)
        const headers = jsonData.length > 0 ? Object.keys(jsonData[0]) : [];

        const detectedEntity = detectEntityType(file.name, workbook.SheetNames)
        if (detectedEntity !== entity) {
          throw new Error(`File seems to contain ${detectedEntity || 'other'} data, not ${entity}.`)
        }

        setSheets(prev => ({
          ...prev,
          [entity]: { name: entity.charAt(0).toUpperCase() + entity.slice(1), jsonData, headers }
        }))
        localStorage.setItem(`upload:${entity}`, JSON.stringify(jsonData))
      } catch (error) {
        console.error('Import failed:', error)
        setError(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }
    reader.readAsBinaryString(file)
  }

  const exportSheet = (entity: EntityType) => {
    try {
      const sheet = sheets[entity]
      if (sheet.jsonData.length === 0) { setError('No data to export'); return }
      const ws = XLSX.utils.json_to_sheet(sheet.jsonData)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, sheet.name)
      XLSX.writeFile(wb, `${sheet.name}.xlsx`)
    } catch (error) {
      console.error('Export failed:', error)
      setError('Failed to export sheet')
    }
  }

  const addRule = () => {
    if (!newRule.type) return
    const rule: any = { id: `rule-${Date.now()}`, active: true, ...newRule }
    setRules([...rules, rule])
    setNewRule({ type: 'coRun', active: true, tasks: [] })
  }

  const toggleRule = (id: string) => {
    setRules(rules.map(rule => rule.id === id ? { ...rule, active: !rule.active } : rule))
  }

  const removeRule = (id: string) => {
    setRules(rules.filter(rule => rule.id !== id))
  }

  const generateRulesConfig = () => {
    const activeRules = rules.filter(rule => rule.active)
    const config = { version: '1.0', timestamp: new Date().toISOString(), rules: activeRules.map(({ id, ...rest }) => rest) }
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'rules.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url)
  }

  const formatCellValue = (value: any): string => {
    if (value === null || value === undefined) return ''
    if (Array.isArray(value)) return value.join(', ')
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }

  const filteredErrors = useMemo(() => {
    return validationErrors.filter(error =>
      (showFixed || !error.fixed) &&
      (searchTerm === '' ||
        error.message.toLowerCase().includes(searchTerm.toLowerCase()) ||
        error.field.toLowerCase().includes(searchTerm.toLowerCase()))
    )
  }, [validationErrors, searchTerm, showFixed])

  const callAiFixApi = async (prompt: string): Promise<AiFixResponse> => {
    const response = await axios.post('/api/ai-fix', {
      text: prompt
    });

    console.log("Raw AI Response:", response.data);

    if (response.status !== 200) {
      throw new Error(`API call failed with status: ${response.status}`);
    }

    let jsonString = response.data.summary;
    const match = jsonString.match(/```json\n([\s\S]*?)\n```/);
    if (match && match[1]) {
      jsonString = match[1];
    }

    const aiResponse = JSON.parse(jsonString);
    return aiResponse;
  };
  const autoFixErrors = useCallback(async () => {
    setError(null);
    if (validationErrors.filter(e => !e.fixed).length === 0) {
      toast.error('No errors to fix.');
      return;
    }


    setIsFixingWithAI(true); 

    try {
      const prompt = `You are an AI assistant that helps fix data validation errors. Your task is to analyze the provided data and validation errors, and then suggest fixes in a strict JSON format. 

    **IMPORTANT:** You MUST only respond with a single JSON object. Do NOT include any other text, explanations, or markdown outside of the JSON. The JSON should have a single key, "fixes", which is an array of fix objects. Each fix object MUST have "entity", "rowIndex", "field", and "newValue" properties.

    Here is the current data state:
    Clients: ${JSON.stringify(sheets.clients.jsonData)}
    Workers: ${JSON.stringify(sheets.workers.jsonData)}
    Tasks: ${JSON.stringify(sheets.tasks.jsonData)}

    Here are the validation errors that need fixing:
    ${JSON.stringify(validationErrors.filter(e => !e.fixed))}

    Example of expected JSON response:
    \`\`\`json
    {
      "fixes": [
        {
          "entity": "clients",
          "rowIndex": 0,
          "field": "requestedTasks",
          "newValue": "task1,task2"
        },
        {
          "entity": "tasks",
          "rowIndex": 1,
          "field": "priority",
          "newValue": 3
        }
      ]
    }
    \`\`\`

    Now, provide the JSON response with suggested fixes for the given errors.`;

      const aiResponse = await callAiFixApi(prompt);

      if (aiResponse.fixes && aiResponse.fixes.length > 0) {
        const newSheets = structuredClone(sheets);
        const fixedErrorIds: string[] = [];

        aiResponse.fixes.forEach(fix => {
          const { entity, rowIndex, field, newValue } = fix;
          if (newSheets[entity] && newSheets[entity].jsonData[rowIndex]) {
            const item = newSheets[entity].jsonData[rowIndex];
            const keyToUpdate = Object.keys(item).find(k => normalizeFieldName(k) === normalizeFieldName(field)) || field;
            item[keyToUpdate] = newValue;

            const errorId = validationErrors.find(e =>
              e.entity === entity &&
              e.rowIndex === rowIndex &&
              normalizeFieldName(e.field) === normalizeFieldName(field) &&
              !e.fixed
            )?.id;
            if (errorId) {
              fixedErrorIds.push(errorId);
            }
          }
        });

        setSheets(newSheets);
        await validateAllData(newSheets);

        toast.success('Fixes applied. Re-validating data...');
      } else {
        toast.error('AI did not suggest any fixes.');
      }
    } catch (err: any) {
      console.error('AI auto-fix failed:', err);
      toast.error(`AI auto-fix failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsFixingWithAI(false); 
    }
  }, [sheets, validateAllData, getNormalizedValue, parseArrayString]);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-2xl font-semibold text-gray-900 mb-6">Data Validation Dashboard</h1>

        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-3 space-y-6">
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as EntityType)}>
              <TabsList className="grid grid-cols-3 w-full bg-gray-100">
                <TabsTrigger value="clients">Clients</TabsTrigger>
                <TabsTrigger value="workers">Workers</TabsTrigger>
                <TabsTrigger value="tasks">Tasks</TabsTrigger>
              </TabsList>

              {(['clients', 'workers', 'tasks'] as EntityType[]).map((entity) => (
                <TabsContent key={entity} value={entity} className="mt-4">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-medium text-gray-800">{sheets[entity].name}</h2>
                    <div className="flex gap-2">
                      <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => handleFileImport(e, entity)} className="hidden" id={`file-import-${entity}`} />
                      <Button variant="outline" size="sm" onClick={() => document.getElementById(`file-import-${entity}`)?.click()}>
                        <Upload className="h-4 w-4 mr-2" /> Import
                      </Button>
                      <Button size="sm" onClick={() => exportSheet(entity)} disabled={sheets[entity].jsonData.length === 0}>
                        <Download className="h-4 w-4 mr-2" /> Export
                      </Button>
                    </div>
                  </div>

                  <ScrollArea className="whitespace-nowrap rounded-md border">
                    <div className="relative rounded-md" style={{ maxHeight: '60vh', overflow: 'auto' }}>
                      <Table>
                        <TableHeader className="bg-gray-50 sticky top-0 z-10">
                          <TableRow>
                            {sheets[entity].headers.map((header, idx) => <TableHead key={idx}>{header}</TableHead>)}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sheets[entity].jsonData.length > 0 ? (
                            sheets[entity].jsonData.map((row: any, rowIndex: number) => {
                              const rowErrors = validationErrors.filter(e => e.entity === entity && e.rowIndex === rowIndex && !e.fixed)
                              return (
                                <TableRow key={`${entity}-${getNormalizedValue(row, ['id']) || rowIndex}`} className={rowErrors.length > 0 ? (rowErrors.some(e => e.level === 'error') ? 'bg-red-50' : 'bg-yellow-50') : ''}>
                                  {sheets[entity].headers.map((header, cellIdx) => {
                                    const cellKey = `${entity}-${rowIndex}-${header}`
                                    const isEditing = editMode[cellKey]
                                    const cellValue = row[header]
                                    const cellErrors = rowErrors.filter(e => normalizeFieldName(e.field) === normalizeFieldName(header));
                                    return (
                                      <TableCell key={cellIdx} onDoubleClick={() => setEditMode({ [cellKey]: true })} className={cellErrors.length > 0 ? 'border-l-2 border-red-500' : ''}>
                                        {isEditing ? (
                                          <Input
                                            defaultValue={formatCellValue(cellValue)}
                                            onBlur={(e) => handleCellEdit(entity, rowIndex, header, e.target.value)}
                                            onKeyDown={(e) => { if (e.key === 'Enter') handleCellEdit(entity, rowIndex, header, e.currentTarget.value) }}
                                            autoFocus
                                          />
                                        ) : (
                                          <div className="min-h-[24px]">{formatCellValue(cellValue)}</div>
                                        )}
                                        {cellErrors.map((err, i) => (
                                          <div key={i} className={`text-xs mt-1 ${err.level === 'error' ? 'text-red-600' : 'text-yellow-600'}`}>{err.message}</div>
                                        ))}
                                      </TableCell>
                                    )
                                  })}
                                </TableRow>
                              )
                            })
                          ) : (
                            <TableRow>
                              <TableCell colSpan={sheets[entity].headers.length || 1} className="text-center text-gray-500 py-8">
                                No data available. Import a file to get started.
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                    <ScrollBar orientation="horizontal" />
                  </ScrollArea>
                </TabsContent>
              ))}
            </Tabs>

            <Card>
              <CardHeader><CardTitle>Business Rules Configuration</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <Select value={activeRuleType} onValueChange={(v) => { setActiveRuleType(v as Rule['type']); setNewRule({ type: v as Rule['type'], active: true, tasks: [] }) }}>
                    <SelectTrigger><SelectValue placeholder="Select rule type" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="coRun">Co-run Tasks</SelectItem>
                      <SelectItem value="slotRestriction">Slot Restriction</SelectItem>
                      <SelectItem value="loadLimit">Load Limit</SelectItem>
                      <SelectItem value="phaseWindow">Phase Window</SelectItem>
                      <SelectItem value="patternMatch">Pattern Match</SelectItem>
                      <SelectItem value="precedenceOverride">Precedence Override</SelectItem>
                    </SelectContent>
                  </Select>

                  {activeRuleType === 'coRun' && (
                    <div className="col-span-2 p-2 border rounded-md">
                      <p className="text-sm font-medium mb-2">Select tasks to co-run:</p>
                      <ScrollArea className="h-32">
                        {sheets.tasks.jsonData.map((task: any, index: number) => {
                          const taskId = getNormalizedValue(task, ['id', 'taskId'])
                          const taskName = getNormalizedValue(task, ['name', 'taskName'])
                          return (
                            <div key={`${taskId}-${index}`} className="flex items-center space-x-2 mb-1">
                              <input type="checkbox" id={`task-${taskId}-${index}`}
                                checked={newRule.tasks?.includes(taskId) || false}
                                onChange={e => {
                                  const currentTasks = newRule.tasks || []
                                  const newTasks = e.target.checked ? [...currentTasks, taskId] : currentTasks.filter(t => t !== taskId)
                                  setNewRule({ ...newRule, tasks: newTasks })
                                }}
                              />
                              <label htmlFor={`task-${taskId}-${index}`} className="text-sm">{taskName || taskId}</label>
                            </div>
                          )
                        })}
                      </ScrollArea>
                    </div>
                  )}

                  {activeRuleType === 'slotRestriction' && (
                    <>
                      <Input placeholder="Client Group" value={newRule.clientGroup || ''} onChange={e => setNewRule({ ...newRule, clientGroup: e.target.value })} />
                      <Input placeholder="Worker Group" value={newRule.workerGroup || ''} onChange={e => setNewRule({ ...newRule, workerGroup: e.target.value })} />
                      <Input type="number" placeholder="Min Common Slots" value={newRule.minCommonSlots || ''} onChange={e => setNewRule({ ...newRule, minCommonSlots: Number(e.target.value) })} />
                    </>
                  )}
                  {/* Other rule types */}
                </div>
                <Button onClick={addRule} className="w-full">Add Rule</Button>
                <div className="space-y-2">
                  <h3 className="text-sm font-medium">Active Rules</h3>
                  {rules.map(rule => (
                    <div key={rule.id} className="p-3 rounded-lg bg-gray-50 border flex justify-between items-center">
                      <div>
                        <div className="font-medium capitalize">{rule.type}</div>
                        <div className="text-xs text-gray-500">{JSON.stringify(rule)}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch checked={rule.active} onCheckedChange={() => toggleRule(rule.id)} />
                        <Button variant="ghost" size="sm" onClick={() => removeRule(rule.id)}>Remove</Button>
                      </div>
                    </div>
                  ))}
                </div>
                <Button onClick={generateRulesConfig} disabled={rules.length === 0} className="w-full">Generate Rules Config</Button>
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-1">
            <div className="sticky top-6 space-y-4">
              <Card>
                <CardHeader><CardTitle>Validation Summary</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
                      <Input placeholder="Filter errors..." className="pl-8" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                    </div>
                    <Button variant={showFixed ? 'secondary' : 'outline'} size="sm" onClick={() => setShowFixed(!showFixed)}>
                      <Filter className="h-4 w-4 mr-2" /> {showFixed ? 'All' : 'Unfixed'}
                    </Button>
                  </div>
                  <Button
                    onClick={autoFixErrors}
                    disabled={filteredErrors.filter(e => !e.fixed).length === 0 || isFixingWithAI}
                    className="w-full mt-2"
                  >
                    {isFixingWithAI ? 'Fixing...' : `Fix with AI (${filteredErrors.filter(e => !e.fixed).length} errors)`}
                  </Button>
                  <div className="w-full mt-4">
                    <Progress value={validationProgress} className="w-full" />
                    <p className="text-center text-sm text-gray-500 mt-1">{validationProgress}% Validated</p>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span>Total Issues:</span>
                      <div className="flex gap-2">
                        <Badge variant="destructive">{filteredErrors.filter(e => e.level === 'error').length} Errors</Badge>
                        <Badge variant="secondary">{filteredErrors.filter(e => e.level === 'warning').length} Warnings</Badge>
                      </div>
                    </div>
                    <ScrollArea className="h-96 rounded-md border bg-white">
                      {filteredErrors.length === 0 ? (
                        <div className="p-4 text-center text-gray-500">No {showFixed ? '' : 'unfixed'} issues.</div>
                      ) : (
                        <div className="p-2 space-y-2">
                          {filteredErrors.map((error, i) => (
                            <div key={error.id} className={`p-2 rounded-md border ${error.level === 'error' ? 'bg-red-50 border-red-200' : 'bg-yellow-50 border-yellow-200'}`}>
                              <div className="flex justify-between items-start">
                                <div>
                                  <div className="font-medium text-sm">
                                    {error.entity} {error.rowIndex >= 0 ? `Row ${error.rowIndex + 1}` : ''}: {error.field}
                                  </div>
                                  <div className="text-xs text-gray-600">{error.message}</div>
                                </div>
                                {!error.fixed && <Button variant="ghost" size="sm" className="text-xs h-6" onClick={() => markAsFixed(error.id)}>Mark fixed</Button>}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </ScrollArea>
                  </div>
                  <div className="text-xs text-gray-500">
                    <p className="font-medium mb-1">Total records:</p>
                    <ul className="space-y-1">
                      <li className="flex justify-between"><span>Clients:</span><span className="font-medium">{sheets.clients.jsonData.length}</span></li>
                      <li className="flex justify-between"><span>Workers:</span><span className="font-medium">{sheets.workers.jsonData.length}</span></li>
                      <li className="flex justify-between"><span>Tasks:</span><span className="font-medium">{sheets.tasks.jsonData.length}</span></li>
                    </ul>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Dashboard