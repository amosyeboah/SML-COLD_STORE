import type { ReportsData } from '@/types'
import { getApi } from './api'

export const reportsService = {
  getData: (startDate: string, endDate: string): Promise<ReportsData> =>
    getApi().getReportsData(startDate, endDate),
  exportExcel: (startDate: string, endDate: string) =>
    getApi().exportReportsExcel(startDate, endDate),
}

