import { describe, it, expect } from 'vitest'
import { detectDestinations } from './destinations.js'

describe('detectDestinations', () => {
  it('sinopsiste geçen yer adından doğru destinasyonu bulur', () => {
    expect(detectDestinations('Bir aile Kapadokya\'da balon turuna çıkar.', 'Test Dizisi')).toEqual(['kapadokya'])
  })

  it('hiçbir bilinen yer adı geçmiyorsa boş dizi döner (uydurmaz)', () => {
    expect(detectDestinations('Bir grup arkadaşın şehirdeki maceraları.', 'Test Dizisi')).toEqual([])
  })

  it('overview boş/null olduğunda çökmez', () => {
    expect(detectDestinations(null, 'Test Dizisi')).toEqual([])
    expect(detectDestinations(undefined, undefined)).toEqual([])
  })

  it('birden fazla eşleşmeyi anahtar kelime sayısına göre sıralar', () => {
    // Mardin 2 anahtar kelime (mardin, midyat) içeriyor, Adana ise 1 — Mardin önde olmalı
    const result = detectDestinations('Mardin ve Midyat\'ta geçen hikaye, bir de Adana\'ya uğrarlar.', '')
    expect(result[0]).toBe('mardin')
    expect(result).toContain('adana')
  })

  it('isim alanındaki yer adını da tarar, sadece overview değil', () => {
    expect(detectDestinations('', 'Bodrum Sevdası')).toEqual(['bodrum'])
  })

  it('büyük/küçük harf ve Türkçe karakter duyarlılığını doğru yönetir', () => {
    expect(detectDestinations('İSTANBUL sokaklarında geçen bir aşk hikayesi.', '')).toEqual(['istanbul'])
  })
})
