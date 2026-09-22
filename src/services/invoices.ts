import type { Invoice, InvoiceStatus, CartItem } from '@/types'
import { getApi } from './api'

export const invoicesService = {
  getAll: (filters?: { startDate?: string; endDate?: string; status?: string }): Promise<Invoice[]> =>
    getApi().getInvoices(filters),
  getById: (id: number): Promise<Invoice> => getApi().getInvoiceById(id),
  create: (data: {
    customerName?: string
    patientName?: string
    insuranceProvider?: string
    items: { type: 'medicine' | 'product' | 'service'; itemId: number; quantity: number; unitPrice: number; insuranceCoverage: number }[]
    tax?: number
    notes?: string
  }): Promise<Invoice> => getApi().createInvoice(data),
  updateStatus: (id: number, status: InvoiceStatus): Promise<Invoice> =>
    getApi().updateInvoiceStatus(id, status),
}

