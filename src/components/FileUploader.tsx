"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";
import * as XLSX from "xlsx";
import { toast } from "sonner"; // <-- Import toast from sonner
import { Button } from "@/components/ui/button";
import { UploadCloud, File, X, Loader2 } from "lucide-react";

export function FileUploader() {
  const [file, setFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  // components/FileUploader.tsx

  const validateFile = (workbook: XLSX.WorkBook): boolean => {
    const requiredSheets = ["clients", "workers", "tasks"];
    const sheetNames = workbook.SheetNames.map(name => name.toLowerCase());
    
    const hasRequiredSheets =
      sheetNames.length === 3 &&
      requiredSheets.every((sheet) => sheetNames.includes(sheet));

    if (!hasRequiredSheets) {
      toast.error("Invalid Sheets", {
        description: "File must contain 'clients', 'workers', and 'tasks' sheets.",
      });
      return false;
    }

    const headers: { [key: string]: string[] } = {
      clients: ["clientid", "clientname", "contactperson"],
      workers: ["workerid", "workername", "hourlyrate"],
      tasks: ["taskid", "clientid", "workerid", "taskdescription", "hours"],
    };

    for (const sheetName of requiredSheets) {
      const worksheet = workbook.Sheets[sheetName];
      
      // --- FIX IS HERE ---
      const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      const actualHeaders = rows[0] && Array.isArray(rows[0]) ? rows[0] : [];
      // -----------------

      const formattedHeaders = actualHeaders.map(h => String(h).toLowerCase().replace(/\s+/g, ''));
      
      const expectedHeaders = headers[sheetName];
      const hasCorrectHeaders =
        expectedHeaders.length === formattedHeaders.length &&
        expectedHeaders.every((header, index) => header === formattedHeaders[index]);

      if (!hasCorrectHeaders) {
        toast.error(`Invalid Headers in '${sheetName}'`, {
          description: `Expected: ${headers[sheetName].join(", ")}`,
        });
        return false;
      }
    }

    return true;
  };

  const onDrop = async (acceptedFiles: File[]) => {
    const selectedFile = acceptedFiles[0];
    if (!selectedFile) return;

    if (!selectedFile.name.match(/\.(xlsx|csv)$/i)) {
      toast.error("Invalid File Type", { // <-- Updated toast call
        description: "Please upload a .xlsx or .csv file.",
      });
      return;
    }

    setFile(selectedFile);
    setIsLoading(true);

    try {
      const data = await selectedFile.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });

      if (validateFile(workbook)) {
        toast.success("Validation Successful!", { // <-- Updated toast call
          description: "Redirecting to your dashboard...",
        });
        setTimeout(() => {
          router.push(`/dashboard/${encodeURIComponent(selectedFile.name)}`);
        }, 1500);
      } else {
        setFile(null);
      }
    } catch (error) {
      toast.error("Error Processing File", { // <-- Updated toast call
        description: "Could not read or validate the file.",
      });
      setFile(null);
    } finally {
      setIsLoading(false);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
    accept: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "text/csv": [".csv"],
    },
  });

  // ... The rest of the JSX remains exactly the same
  return (
    <div className="w-full max-w-lg mx-auto">
      {file && !isLoading ? (
        <div className="relative flex items-center justify-between p-4 bg-zinc-800 border border-zinc-700 rounded-lg">
           <div className="flex items-center gap-4">
             <File className="h-8 w-8 text-white" />
             <p className="text-sm font-medium text-white">{file.name}</p>
           </div>
          <button
            onClick={() => setFile(null)}
            className="p-1 rounded-full hover:bg-zinc-700 transition-colors"
          >
            <X className="h-5 w-5 text-zinc-400" />
          </button>
        </div>
      ) : (
        <div
          {...getRootProps()}
          className={`relative flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-xl cursor-pointer
            transition-all duration-300 ease-in-out
            ${isDragActive ? "border-indigo-500 bg-zinc-800/50" : "border-zinc-700 hover:border-indigo-500/80"}`}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 via-transparent to-transparent opacity-50 transition-opacity duration-300"></div>
          <input {...getInputProps()} />

          {isLoading ? (
             <div className="flex flex-col items-center gap-4 text-center">
                <Loader2 className="h-10 w-10 text-white animate-spin" />
                <p className="font-medium text-white">Validating file...</p>
             </div>
          ) : (
             <div className="flex flex-col items-center gap-4 text-center">
                <UploadCloud className="h-10 w-10 text-zinc-500" />
                <p className="font-medium text-white">
                  Drag & drop your file here, or{" "}
                  <span className="font-semibold text-indigo-400">browse</span>
                </p>
                <p className="text-xs text-zinc-500">Supports: XLSX, CSV</p>
             </div>
          )}
        </div>
      )}

      <Button
        onClick={() => {
          if (file) {
            onDrop([file]);
          }
        }}
        disabled={!file || isLoading}
        className="w-full mt-6 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-base rounded-lg transition-all duration-300 transform hover:scale-105"
        size="lg"
      >
        {isLoading ? "Validating..." : "Upload & Continue"}
      </Button>
    </div>
  );
}