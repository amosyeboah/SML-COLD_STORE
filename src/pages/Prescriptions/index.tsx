import { useQuery } from '@tanstack/react-query'
import { FileText, Calendar, User, UserCheck } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export default function Prescriptions() {
  const { data: prescriptions = [], isLoading } = useQuery<any[]>({
    queryKey: ['prescriptions'],
    queryFn: () => window.api.getPrescriptions(),
  })

  return (
    <div className="p-6 space-y-6 font-sans">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">Prescriptions</h2>
        <p className="text-sm text-slate-500 font-normal">Registry logs of prescription validations linked to sales orders</p>
      </div>

      <Card className="border-slate-100 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-slate-800 font-semibold flex items-center gap-2">
            <FileText className="w-4 h-4 text-teal-600" />
            Validation History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Doctor Name</TableHead>
                  <TableHead>Medicines Dispensed</TableHead>
                  <TableHead>Dosage / Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {prescriptions.map((pres) => (
                  <TableRow key={pres.id}>
                    <TableCell className="text-slate-600 flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      {new Date(pres.date).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-semibold text-slate-700">
                      <span className="flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-slate-400" />
                        {pres.customer?.name}
                      </span>
                    </TableCell>
                    <TableCell className="font-semibold text-slate-700">
                      <span className="flex items-center gap-1.5">
                        <UserCheck className="w-3.5 h-3.5 text-teal-500" />
                        {pres.doctorName}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-0.5">
                        {pres.sale?.items?.map((item: any) => (
                          <div key={item.id} className="text-xs font-semibold text-slate-600">
                            {item.batch?.medicine?.name} (x{item.quantity})
                          </div>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-slate-500 text-xs max-w-xs truncate" title={pres.notes || ''}>
                      {pres.notes || 'N/A'}
                    </TableCell>
                  </TableRow>
                ))}
                {prescriptions.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-slate-400 py-8">
                      No prescriptions validated yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
